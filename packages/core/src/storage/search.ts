import type { Logger } from 'pino';
import type { SearchOptions, SearchResult, Note, NoteMetadata } from '@echos/shared';
import type { SqliteStorage, NoteRow, FtsOptions } from './sqlite.js';
import type { VectorStorage, VectorSearchResult } from './vectordb.js';
import type { MarkdownStorage } from './markdown.js';
import { rerank } from './reranker.js';

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
 * Sigmoid-shaped hotness factor based on retrieval count and recency of last access.
 * - sigmoid(log1p(n)) maps retrieval count to [0, 1) — saturates slowly
 * - multiplied by temporal decay of last access so stale popularity fades
 */
export function computeHotnessBoost(
  retrievalCount: number,
  lastAccessed: string,
  halfLifeDays: number,
): number {
  const x = Math.log1p(retrievalCount);
  const sigmoid = 1 / (1 + Math.exp(-x));
  const recency = computeTemporalDecay(lastAccessed, halfLifeDays);
  return sigmoid * recency;
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

export interface SearchServiceConfig {
  anthropicApiKey?: string;
}

export function createSearchService(
  sqlite: SqliteStorage,
  vectorDb: VectorStorage,
  mdStorage: MarkdownStorage,
  logger: Logger,
  config: SearchServiceConfig = {},
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

      // Resolve notes from the full candidate set, apply temporal decay, then truncate.
      // Decay must be applied before slicing because it can change relative ordering:
      // a recent-but-lower-RRF note may overtake an older higher-RRF note after decay.
      const applyDecay = opts.temporalDecay !== false;
      const applyHotness = opts.hotnessBoost !== false;
      const halfLife = opts.decayHalfLifeDays ?? TEMPORAL_DECAY_DEFAULT_HALF_LIFE;

      // Resolve all candidate rows first so we can batch-fetch hotness data.
      const resolvedCandidates: Array<{ noteRow: NoteRow; score: number }> = [];
      for (const { id, score } of fused) {
        const noteRow = sqlite.getNote(id);
        if (!noteRow) continue;
        if (noteRow.status === 'deleted') continue;
        resolvedCandidates.push({ noteRow, score });
      }

      // Batch-fetch hotness data for all candidates in one query.
      const candidateIds = resolvedCandidates.map(({ noteRow }) => noteRow.id);
      const hotnessMap = applyHotness ? sqlite.getHotness(candidateIds) : new Map<string, { retrievalCount: number; lastAccessed: string }>();

      const candidates: SearchResult[] = [];
      for (const { noteRow, score } of resolvedCandidates) {
        let finalScore = applyDecay
          ? score * computeTemporalDecay(noteRow.created, halfLife)
          : score;

        if (applyHotness) {
          const hotness = hotnessMap.get(noteRow.id);
          if (hotness) {
            finalScore *= 1 + HOTNESS_WEIGHT * computeHotnessBoost(hotness.retrievalCount, hotness.lastAccessed, halfLife);
          }
        }

        candidates.push(noteRowToSearchResult(noteRow, finalScore, mdStorage, logger));
      }

      // Sort by final score and take top `limit`
      candidates.sort((a, b) => b.score - a.score);
      const sliced = candidates.slice(0, limit);

      // Optional reranking stage — uses Claude as a cross-encoder for highest-quality relevance scoring.
      // Off by default (adds one API call per search). Requires anthropicApiKey to be configured.
      let results = sliced;
      let rerankApplied = false;
      if (opts.rerank && config.anthropicApiKey) {
        results = await rerank(opts.query, sliced, config.anthropicApiKey, logger);
        rerankApplied = true;
      } else if (opts.rerank && !config.anthropicApiKey) {
        logger.warn({ query: opts.query }, 'Rerank requested but no anthropicApiKey configured — skipping');
      }

      // Record access unconditionally: hotness data is always collected even
      // when hotnessBoost is disabled, so future searches can benefit from it.
      for (const r of results) {
        sqlite.recordAccess(r.note.metadata.id);
      }

      logger.debug(
        { query: opts.query, ftsCount: ftsRows.length, vectorCount: vectorResults.length, resultCount: results.length, temporalDecay: applyDecay, hotnessBoost: applyHotness, rerankRequested: opts.rerank ?? false, rerankApplied },
        'Hybrid search',
      );
      return results;
    },
  };
}
