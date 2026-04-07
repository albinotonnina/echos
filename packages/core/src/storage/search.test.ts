import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeTemporalDecay, createSearchService } from './search.js';
import type { SqliteStorage, NoteRow } from './sqlite.js';
import type { VectorStorage } from './vectordb.js';
import type { MarkdownStorage } from './markdown.js';
import { createLogger } from '@echos/shared';

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
      // Hotness stubs — no hotness data by default so decay tests are unaffected
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
    // No hotness data → no hotness boost applied
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
// createSearchService — hotness scoring tests
//
// Setup: two notes with equal content relevance (same RRF rank in both legs).
//   'popular' — retrieved 50 times recently
//   'obscure' — no retrieval history
//
// With hotness on: 'popular' should score higher.
// With hotnessBoost: false: scores should reflect RRF + decay only.
// ---------------------------------------------------------------------------

describe('createSearchService - hotness scoring', () => {
  let sqlite: SqliteStorage;
  let vectorDb: VectorStorage;
  let mdStorage: MarkdownStorage;

  function makeRow(id: string, createdDaysAgo: number = 0): NoteRow {
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
      popular: makeRow('popular', 0),
      obscure: makeRow('obscure', 0),
    };

    // 'popular' has equal or slightly lower RRF rank — hotness should elevate it
    sqlite = {
      searchFts: vi.fn().mockReturnValue([rows['popular'], rows['obscure']]),
      getNote: vi.fn().mockImplementation((id: string) => rows[id]),
      getHotness: vi.fn().mockReturnValue(
        new Map([
          ['popular', { retrievalCount: 50, lastAccessed: new Date().toISOString() }],
        ]),
      ),
      recordAccess: vi.fn(),
    } as unknown as SqliteStorage;

    vectorDb = {
      search: vi.fn().mockResolvedValue([
        { id: 'obscure', score: 0.9, type: 'note', title: 'obscure', text: '' },
        { id: 'popular', score: 0.85, type: 'note', title: 'popular', text: '' },
      ]),
    } as unknown as VectorStorage;

    mdStorage = {
      read: vi.fn().mockReturnValue(undefined),
    } as unknown as MarkdownStorage;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('notes retrieved 50 times score higher than notes retrieved once', async () => {
    const service = createSearchService(sqlite, vectorDb, mdStorage, logger);

    // 'once' scenario: override popular's retrieval count to 1
    (sqlite.getHotness as ReturnType<typeof vi.fn>).mockReturnValue(
      new Map([
        ['popular', { retrievalCount: 50, lastAccessed: new Date().toISOString() }],
        ['obscure', { retrievalCount: 1, lastAccessed: new Date().toISOString() }],
      ]),
    );

    const results = await service.hybrid({ query: 'test', limit: 2, vector: [] });

    const popularResult = results.find((r) => r.note.metadata.id === 'popular');
    const obscureResult = results.find((r) => r.note.metadata.id === 'obscure');
    expect(popularResult).toBeDefined();
    expect(obscureResult).toBeDefined();

    // popular has lower raw RRF score but 50 retrievals should boost it above obscure
    expect(popularResult!.score).toBeGreaterThan(obscureResult!.score);
  });

  it('hotnessBoost: false disables hotness and restores pre-hotness scoring', async () => {
    const service = createSearchService(sqlite, vectorDb, mdStorage, logger);

    // Make 'obscure' rank 1 in both lists so it wins cleanly without hotness
    (sqlite.searchFts as ReturnType<typeof vi.fn>).mockReturnValue([
      makeRow('obscure', 0),
      makeRow('popular', 0),
    ]);
    (vectorDb.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'obscure', score: 0.95, type: 'note', title: 'obscure', text: '' },
      { id: 'popular', score: 0.8, type: 'note', title: 'popular', text: '' },
    ]);

    // Without hotness, 'obscure' ranks first (rank 1 in both lists → higher RRF)
    const results = await service.hybrid({
      query: 'test',
      limit: 2,
      vector: [],
      hotnessBoost: false,
      temporalDecay: false,
    });

    expect(results[0]!.note.metadata.id).toBe('obscure');
  });

  it('records access for every returned result', async () => {
    const service = createSearchService(sqlite, vectorDb, mdStorage, logger);
    await service.hybrid({ query: 'test', limit: 2, vector: [] });

    expect(sqlite.recordAccess).toHaveBeenCalledTimes(2);
    expect(sqlite.recordAccess).toHaveBeenCalledWith('popular');
    expect(sqlite.recordAccess).toHaveBeenCalledWith('obscure');
  });

  it('hotness decays with time since last access', async () => {
    const service = createSearchService(sqlite, vectorDb, mdStorage, logger);

    // Two notes, both retrieved 50 times; one last accessed today, one 6 months ago
    const rows: Record<string, NoteRow> = {
      recent: makeRow('recent', 0),
      stale: makeRow('stale', 0),
    };

    (sqlite.searchFts as ReturnType<typeof vi.fn>).mockReturnValue([rows['recent'], rows['stale']]);
    (sqlite.getNote as ReturnType<typeof vi.fn>).mockImplementation((id: string) => rows[id]);
    (sqlite.getHotness as ReturnType<typeof vi.fn>).mockReturnValue(
      new Map([
        ['recent', { retrievalCount: 50, lastAccessed: new Date().toISOString() }],
        ['stale', { retrievalCount: 50, lastAccessed: new Date(Date.now() - 180 * DAY_MS).toISOString() }],
      ]),
    );

    (vectorDb.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'stale', score: 0.9, type: 'note', title: 'stale', text: '' },
      { id: 'recent', score: 0.85, type: 'note', title: 'recent', text: '' },
    ]);

    const results = await service.hybrid({ query: 'test', limit: 2, vector: [], temporalDecay: false });

    const recentResult = results.find((r) => r.note.metadata.id === 'recent');
    const staleResult = results.find((r) => r.note.metadata.id === 'stale');
    expect(recentResult).toBeDefined();
    expect(staleResult).toBeDefined();

    // stale has higher raw RRF but lower access recency decay → recent should win
    expect(recentResult!.score).toBeGreaterThan(staleResult!.score);
  });
});
