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

      // Resolve notes
      const results: SearchResult[] = [];
      for (const { id, score } of fused.slice(0, limit)) {
        const noteRow = sqlite.getNote(id);
        if (!noteRow) continue;
        results.push(noteRowToSearchResult(noteRow, score, mdStorage, logger));
      }

      logger.debug(
        { query: opts.query, ftsCount: ftsRows.length, vectorCount: vectorResults.length, resultCount: results.length },
        'Hybrid search',
      );
      return results;
    },
  };
}
