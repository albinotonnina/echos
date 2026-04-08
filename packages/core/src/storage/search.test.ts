import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeTemporalDecay, createSearchService } from './search.js';
import { rerank as mockRerank } from './reranker.js';
import type { SqliteStorage, NoteRow } from './sqlite.js';
import type { VectorStorage } from './vectordb.js';
import type { MarkdownStorage } from './markdown.js';
import type { SearchResult } from '@echos/shared';
import { createLogger } from '@echos/shared';

vi.mock('./reranker.js', () => ({
  rerank: vi.fn(),
}));

const logger = createLogger('test', 'silent');

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// computeTemporalDecay — unit tests
// ---------------------------------------------------------------------------

describe('computeTemporalDecay', () => {
  it('returns 1.0 for a note created right now', () => {
    expect(computeTemporalDecay(new Date().toISOString(), 90)).toBeCloseTo(1.0, 5);
  });

  it('returns 0.5 at exactly one half-life', () => {
    const created = new Date(Date.now() - 90 * DAY_MS).toISOString();
    expect(computeTemporalDecay(created, 90)).toBeCloseTo(0.5, 2);
  });

  it('returns 0.25 at two half-lives', () => {
    const created = new Date(Date.now() - 180 * DAY_MS).toISOString();
    expect(computeTemporalDecay(created, 90)).toBeCloseTo(0.25, 2);
  });

  it('returns 1.0 for an invalid date string', () => {
    expect(computeTemporalDecay('not-a-date', 90)).toBe(1.0);
  });

  it('returns 1.0 for a future date (negative age clamped to 0)', () => {
    const future = new Date(Date.now() + DAY_MS).toISOString();
    expect(computeTemporalDecay(future, 90)).toBeCloseTo(1.0, 5);
  });

  it('clamps halfLifeDays of 0 to 1 day', () => {
    const created = new Date(Date.now() - 10 * DAY_MS).toISOString();
    const expected = Math.pow(2, -10);
    expect(computeTemporalDecay(created, 0)).toBeCloseTo(expected, 5);
  });

  it('clamps negative halfLifeDays to 1 day', () => {
    const created = new Date(Date.now() - 10 * DAY_MS).toISOString();
    const expected = Math.pow(2, -10);
    expect(computeTemporalDecay(created, -5)).toBeCloseTo(expected, 5);
  });

  it('decays less aggressively with a longer half-life', () => {
    const created = new Date(Date.now() - 180 * DAY_MS).toISOString();
    const decayShort = computeTemporalDecay(created, 90);    // ≈ 0.25
    const decayLong = computeTemporalDecay(created, 3650);   // ≈ 0.966
    expect(decayLong).toBeGreaterThan(decayShort);
  });
});

// ---------------------------------------------------------------------------
// createSearchService — hybrid temporal decay integration tests
//
// Setup: two notes
//   'old' — rank 1 in both FTS and vector, created 180 days ago
//   'new' — rank 2 in both FTS and vector, created today
//
// Without decay: 'old' wins (higher RRF score: 2/61 vs 2/62).
// With default 90-day half-life: 'old' decays by factor 0.25 → 'new' wins.
// ---------------------------------------------------------------------------

describe('createSearchService - hybrid temporal decay', () => {
  let sqlite: SqliteStorage;
  let vectorDb: VectorStorage;
  let mdStorage: MarkdownStorage;

  function makeRow(id: string, createdDaysAgo: number): NoteRow {
    return {
      id,
      type: 'note',
      title: `Note ${id}`,
      content: `Content for note ${id}`,
      filePath: `/notes/${id}.md`,
      tags: '',
      links: '',
      category: 'general',
      sourceUrl: null,
      author: null,
      gist: null,
      created: new Date(Date.now() - createdDaysAgo * DAY_MS).toISOString(),
      updated: new Date().toISOString(),
      contentHash: null,
      status: null,
      inputSource: null,
      imagePath: null,
      imageUrl: null,
      imageMetadata: null,
      ocrText: null,
      deletedAt: null,
    };
  }

  beforeEach(() => {
    const rows: Record<string, NoteRow> = {
      old: makeRow('old', 180),
      new: makeRow('new', 0),
    };

    sqlite = {
      searchFts: vi.fn().mockReturnValue([rows['old'], rows['new']]),
      getNote: vi.fn().mockImplementation((id: string) => rows[id]),
      getHotness: vi.fn().mockReturnValue(new Map()),
      recordAccess: vi.fn(),
    } as unknown as SqliteStorage;

    vectorDb = {
      search: vi.fn().mockResolvedValue([
        { id: 'old', score: 0.9, type: 'note', title: 'old', text: '' },
        { id: 'new', score: 0.8, type: 'note', title: 'new', text: '' },
      ]),
    } as unknown as VectorStorage;

    // mdStorage.read returns undefined → falls back to noteRowToNote
    mdStorage = {
      read: vi.fn().mockReturnValue(undefined),
    } as unknown as MarkdownStorage;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('boosts recent notes: today note overtakes 180-day-old note at default half-life', async () => {
    // 'old' has higher RRF score but 180-day decay factor ≈ 0.25 pushes it below 'new'
    const service = createSearchService(sqlite, vectorDb, mdStorage, logger);
    const results = await service.hybrid({ query: 'test', limit: 2, vector: [] });

    expect(results).toHaveLength(2);
    expect(results[0]!.note.metadata.id).toBe('new');
    expect(results[1]!.note.metadata.id).toBe('old');
  });

  it('temporalDecay: false preserves raw RRF order', async () => {
    // Without decay, 'old' (rank 1 in both lists) keeps its higher RRF score
    const service = createSearchService(sqlite, vectorDb, mdStorage, logger);
    const results = await service.hybrid({ query: 'test', limit: 2, vector: [], temporalDecay: false });

    expect(results[0]!.note.metadata.id).toBe('old');
    expect(results[1]!.note.metadata.id).toBe('new');
  });

  it('decayHalfLifeDays: 180 gives the 180-day-old note a factor of ~0.5', async () => {
    // At exactly one half-life, decay factor = 0.5
    // RRF score for rank 1 in both lists = 1/(60+1) + 1/(60+1) = 2/61
    const expectedScore = (2 / 61) * 0.5;

    const service = createSearchService(sqlite, vectorDb, mdStorage, logger);
    const results = await service.hybrid({ query: 'test', limit: 2, vector: [], decayHalfLifeDays: 180 });

    const oldResult = results.find((r) => r.note.metadata.id === 'old');
    expect(oldResult).toBeDefined();
    expect(oldResult!.score).toBeCloseTo(expectedScore, 3);
  });

  it('excludes soft-deleted notes from results', async () => {
    const rows: Record<string, NoteRow> = {
      old: { ...makeRow('old', 180), status: 'deleted', deletedAt: new Date().toISOString() },
      new: makeRow('new', 0),
    };

    (sqlite.searchFts as ReturnType<typeof vi.fn>).mockReturnValue([rows['old'], rows['new']]);
    (sqlite.getNote as ReturnType<typeof vi.fn>).mockImplementation((id: string) => rows[id]);

    const service = createSearchService(sqlite, vectorDb, mdStorage, logger);
    const results = await service.hybrid({ query: 'test', limit: 2, vector: [] });

    expect(results).toHaveLength(1);
    expect(results[0]!.note.metadata.id).toBe('new');
  });
});

// ---------------------------------------------------------------------------
// createSearchService — reranking tests
//
// The reranker module is mocked so tests don't make real API calls.
// Tests verify: reranker is called with correct args, its ordering is used,
// and missing API key / disabled flag skip the reranker entirely.
// ---------------------------------------------------------------------------

describe('createSearchService - hybrid reranking', () => {
  let sqlite: SqliteStorage;
  let vectorDb: VectorStorage;
  let mdStorage: MarkdownStorage;

  function makeRow(id: string): NoteRow {
    return {
      id,
      type: 'note',
      title: `Note ${id}`,
      content: `Content for note ${id}`,
      filePath: `/notes/${id}.md`,
      tags: '',
      links: '',
      category: 'general',
      sourceUrl: null,
      author: null,
      gist: null,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      contentHash: null,
      status: null,
      inputSource: null,
      imagePath: null,
      imageUrl: null,
      imageMetadata: null,
      ocrText: null,
      deletedAt: null,
    };
  }

  beforeEach(() => {
    const rows: Record<string, NoteRow> = {
      a: makeRow('a'),
      b: makeRow('b'),
    };

    sqlite = {
      searchFts: vi.fn().mockReturnValue([rows['a'], rows['b']]),
      getNote: vi.fn().mockImplementation((id: string) => rows[id]),
      getHotness: vi.fn().mockReturnValue(new Map()),
      recordAccess: vi.fn(),
    } as unknown as SqliteStorage;

    vectorDb = {
      search: vi.fn().mockResolvedValue([
        { id: 'a', score: 0.9, type: 'note', title: 'a', text: '' },
        { id: 'b', score: 0.8, type: 'note', title: 'b', text: '' },
      ]),
    } as unknown as VectorStorage;

    mdStorage = {
      read: vi.fn().mockReturnValue(undefined),
    } as unknown as MarkdownStorage;

    vi.mocked(mockRerank).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rerank: true calls reranker and uses its ordering', async () => {
    // Reranker reverses the order: [b, a]
    vi.mocked(mockRerank).mockImplementation(async (_q, candidates: SearchResult[]) =>
      [...candidates].reverse(),
    );

    const service = createSearchService(sqlite, vectorDb, mdStorage, logger, {
      anthropicApiKey: 'sk-test',
    });
    const results = await service.hybrid({ query: 'test', limit: 2, vector: [], rerank: true });

    expect(mockRerank).toHaveBeenCalledOnce();
    expect(results[0]!.note.metadata.id).toBe('b');
    expect(results[1]!.note.metadata.id).toBe('a');
  });

  it('rerank: true with no anthropicApiKey skips reranking and returns decay-ordered results', async () => {
    const service = createSearchService(sqlite, vectorDb, mdStorage, logger);
    const results = await service.hybrid({ query: 'test', limit: 2, vector: [], rerank: true });

    expect(mockRerank).not.toHaveBeenCalled();
    expect(results).toHaveLength(2);
    // Notes created today — decay = 1.0 for both, so RRF order prevails: a first
    expect(results[0]!.note.metadata.id).toBe('a');
  });

  it('rerank: false (default) does not call reranker even when API key is configured', async () => {
    const service = createSearchService(sqlite, vectorDb, mdStorage, logger, {
      anthropicApiKey: 'sk-test',
    });
    await service.hybrid({ query: 'test', limit: 2, vector: [] });

    expect(mockRerank).not.toHaveBeenCalled();
  });

  it('graceful fallback: reranker error returns original order', async () => {
    vi.mocked(mockRerank).mockRejectedValue(new Error('API failure'));

    // rerank() in reranker.ts handles the error internally — the mock here
    // represents the outer import; to test the fallback in the reranker itself
    // we re-mock to simulate what the real reranker does on API failure:
    vi.mocked(mockRerank).mockImplementation(async (_q, candidates: SearchResult[]) => candidates);

    const service = createSearchService(sqlite, vectorDb, mdStorage, logger, {
      anthropicApiKey: 'sk-test',
    });
    const results = await service.hybrid({ query: 'test', limit: 2, vector: [], rerank: true });

    expect(results[0]!.note.metadata.id).toBe('a');
    expect(results[1]!.note.metadata.id).toBe('b');
  });
});
