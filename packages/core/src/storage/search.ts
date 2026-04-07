import type { Logger } from 'pino';
import type { SearchOptions, SearchResult, Note, NoteMetadata } from '@echos/shared';
import type { SqliteStorage, NoteRow, FtsOptions } from './sqlite.js';
import type { VectorStorage, VectorSearchResult } from './vectordb.js';
import type { MarkdownStorage } from './markdown.js';

export interface SearchService {
  keyword(opts: SearchOptions): SearchResult[];
  semantic(opts: SearchOptions & { vector: number[] }): Promise<SearchResult[]>;
  hybrid(opts: SearchOptions & { vector: number[] }): Promise<SearchResult[]>;
}

const RRF_K = 60; // Reciprocal rank fusion constant
const TEMPORAL_DECAY_DEFAULT_HALF_LIFE = 90; // days
const HOTNESS_WEIGHT = 0.15;

/**
 * Exponential temporal decay factor.
 * Returns 1.0 for a note created now, decaying toward 0 as the note ages.
 * At `halfLifeDays` the factor is 0.5; at 2x half-life it's 0.25, etc.
 *
 * Inputs are clamped for safety:
 * - Invalid or future `createdAt` → treated as age 0 (factor = 1.0)
 * - `halfLifeDays` must be > 0; values ≤ 0 are clamped to 1 day
 */
export function computeTemporalDecay(createdAt: string, halfLifeDays: number): number {
  const safeHalfLife = Math.max(halfLifeDays, 1);
  const ts = new Date(createdAt).getTime();
  const ageDays = Number.isFinite(ts) ? Math.max((Date.now() - ts) / (1000 * 60 * 60 * 24), 0) : 0;
  return Math.pow(2, -ageDays / safeHalfLife);
}

/**
 * Sigmoid of x, mapped to [0, 1].
 * Used to compress unbounded retrieval counts into a bounded boost factor.
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function noteRowToNote(row: NoteRow): Note {
  const metadata: NoteMetadata = {
    id: row.id,
    type: row.type,
    title: row.title,
    created: row.created,
    updated: row.updated,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
    links: row.links ? row.links.split(',').filter(Boolean) : [],
    category: row.category,
  };
  if (row.sourceUrl != null) metadata.sourceUrl = row.sourceUrl;
  if (row.author != null) metadata.author = row.author;
  if (row.gist != null) metadata.gist = row.gist;
  return { metadata, content: row.content, filePath: row.filePath };
}

function noteRowToSearchResult(
  row: NoteRow,
  score: number,
  mdStorage: MarkdownStorage,
  logger: Logger,
): SearchResult {
  const mdNote = mdStorage.read(row.filePath);
  if (mdNote) return { note: mdNote, score };
  logger.warn({ id: row.id, filePath: row.filePath }, 'Note file missing from disk, falling back to SQLite content');
  return { note: noteRowToNote(row), score };
}

function reciprocalRankFusion(
  ftsResults: Array<{ id: string; rank: number }>,
  vectorResults: Array<{ id: string; rank: number }>,
  k: number = RRF_K,
): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();

  for (const { id, rank } of ftsResults) {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
  }

  for (const { id, rank } of vectorResults) {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
  }

  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

export function createSearchService(
  sqlite: SqliteStorage,
  vectorDb: VectorStorage,
  mdStorage: MarkdownStorage,
  logger: Logger,
): SearchService {
  return {
    keyword(opts: SearchOptions): SearchResult[] {
      const ftsOpts: FtsOptions = { limit: opts.limit ?? 20 };
      if (opts.type) ftsOpts.type = opts.type;
      const rows = sqlite.searchFts(opts.query, ftsOpts);

      const results: SearchResult[] = [];
      for (const row of rows) {
        results.push(noteRowToSearchResult(row, 1, mdStorage, logger));
      }

      logger.debug({ query: opts.query, resultCount: results.length }, 'Keyword search');
      return results;
    },

    async semantic(opts: SearchOptions & { vector: number[] }): Promise<SearchResult[]> {
      const vectorResults = await vectorDb.search(opts.vector, opts.limit ?? 20);

      const results: SearchResult[] = [];
      for (const vr of vectorResults) {
        if (opts.type && vr.type !== opts.type) continue;
        const noteRow = sqlite.getNote(vr.id);
        if (!noteRow) continue;
        // Exclude soft-deleted notes from search results
        if (noteRow.status === 'deleted') continue;
        results.push(noteRowToSearchResult(noteRow, vr.score, mdStorage, logger));
      }

      logger.debug({ query: opts.query, resultCount: results.length }, 'Semantic search');
      return results;
    },

    async hybrid(opts: SearchOptions & { vector: number[] }): Promise<SearchResult[]> {
      const limit = opts.limit ?? 20;

      // Run both searches
      const ftsOpts: FtsOptions = { limit: limit * 2 };
      if (opts.type) ftsOpts.type = opts.type;
      const ftsRows = sqlite.searchFts(opts.query, ftsOpts);
      const vectorResults = await vectorDb.search(opts.vector, limit * 2);

      // Prepare ranked lists
      const ftsRanked = ftsRows.map((row, i) => ({ id: row.id, rank: i + 1 }));
      const vectorRanked: Array<{ id: string; rank: number }> = [];
      for (let i = 0; i < vectorResults.length; i++) {
        const vr = vectorResults[i]!;
        if (opts.type && vr.type !== opts.type) continue;
        vectorRanked.push({ id: vr.id, rank: i + 1 });
      }

      // Fuse rankings
      const fused = reciprocalRankFusion(ftsRanked, vectorRanked);

      // Resolve notes from the full candidate set, apply temporal decay and hotness boost,
      // then truncate. Both modifiers must be applied before slicing because they can
      // change relative ordering across the full candidate set.
      const applyDecay = opts.temporalDecay !== false;
      const halfLife = opts.decayHalfLifeDays ?? TEMPORAL_DECAY_DEFAULT_HALF_LIFE;
      const applyHotness = opts.hotnessBoost !== false;

      // Batch-load hotness data for all candidate IDs (one DB query)
      const candidateIds = fused.map(({ id }) => id);
      const hotnessMap = applyHotness ? sqlite.getHotness(candidateIds) : new Map<string, { retrievalCount: number; lastAccessed: string }>();

      const candidates: SearchResult[] = [];
      for (const { id, score } of fused) {
        const noteRow = sqlite.getNote(id);
        if (!noteRow) continue;
        if (noteRow.status === 'deleted') continue;

        let finalScore = score;

        // Temporal decay: older notes score lower
        if (applyDecay) {
          finalScore *= computeTemporalDecay(noteRow.created, halfLife);
        }

        // Hotness boost: frequently accessed notes score higher.
        // Formula: score *= (1 + hotnessWeight * sigmoid(log1p(retrievalCount)))
        // Access recency modulates the boost via temporal decay on lastAccessed.
        if (applyHotness) {
          const hotness = hotnessMap.get(id);
          if (hotness) {
            const accessDecay = computeTemporalDecay(hotness.lastAccessed, halfLife);
            const hotnessSignal = sigmoid(Math.log1p(hotness.retrievalCount)) * accessDecay;
            finalScore *= 1 + HOTNESS_WEIGHT * hotnessSignal;
          }
        }

        candidates.push(noteRowToSearchResult(noteRow, finalScore, mdStorage, logger));
      }

      // Sort by final score and take top `limit`
      candidates.sort((a, b) => b.score - a.score);
      const results = candidates.slice(0, limit);

      // Record access for all returned notes (fire-and-forget, non-blocking)
      if (results.length > 0) {
        for (const result of results) {
          try {
            sqlite.recordAccess(result.note.metadata.id);
          } catch {
            // Access tracking is best-effort; don't fail the search on write errors
          }
        }
      }

      logger.debug(
        {
          query: opts.query,
          ftsCount: ftsRows.length,
          vectorCount: vectorResults.length,
          resultCount: results.length,
          temporalDecay: applyDecay,
          hotnessBoost: applyHotness,
        },
        'Hybrid search',
      );
      return results;
    },
  };
}
