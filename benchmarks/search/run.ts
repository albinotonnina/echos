#!/usr/bin/env tsx
/**
 * Search Benchmark Runner (task 10.04)
 *
 * For each corpus scale × pipeline configuration:
 *   1. Load synthetic corpus into a temporary SQLite + LanceDB instance
 *   2. Run all queries from queries.json
 *   3. Compute Precision@5, Recall@10, MRR, median latency
 *
 * Output: benchmarks/search/results/{timestamp}.json
 *
 * Usage:
 *   pnpm bench:search [--scale small|medium|large|all] [--config <name>] [--limit N]
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY  — enables the rerank pipeline config (optional)
 */

import { mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createSqliteStorage } from '../../packages/core/src/storage/sqlite.js';
import { createVectorStorageBulk } from '../../packages/core/src/storage/vector-bulk.js';
import { createSearchService } from '../../packages/core/src/storage/search.js';
import type { MarkdownStorage } from '../../packages/core/src/storage/markdown.js';
import type { Note, NoteMetadata } from '../../packages/shared/src/types/index.js';

// Pino Logger interface (type-only, satisfied by the silent logger below)
type PinoLogger = Parameters<typeof createSqliteStorage>[1];

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Silent logger — satisfies the pino Logger interface at runtime
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
const silentLogger: PinoLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
} as unknown as PinoLogger;
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCALES = ['small', 'medium', 'large'] as const;
type Scale = (typeof SCALES)[number];

const PIPELINE_NAMES = [
  'keyword-only',
  'semantic-only',
  'hybrid',
  'hybrid+decay',
  'hybrid+decay+hotness',
  'hybrid+decay+hotness+rerank',
] as const;
type PipelineName = (typeof PIPELINE_NAMES)[number];

/** Pseudo-embedding dimensions — keeps LanceDB tables small for bench speed */
const EMBED_DIMS = 64;

// ---------------------------------------------------------------------------
// Deterministic pseudo-embedding
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed;
  return (): number => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (Math.imul(h, 0x01000193)) >>> 0;
  }
  return h;
}

function normalize(vec: number[]): number[] {
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return mag === 0 ? vec : vec.map((v) => v / mag);
}

/**
 * Deterministic 64-dim unit vector for a corpus note.
 * Notes in the same topic cluster together in the embedding space.
 */
function pseudoEmbedNote(topicIndex: number, noteId: string): number[] {
  const rng = mulberry32(hashStr(noteId));
  const vec: number[] = new Array(EMBED_DIMS).fill(0) as number[];

  // Topic centroid: 6 consecutive dims starting at topicIndex*6 are high
  const base = (topicIndex * 6) % EMBED_DIMS;
  for (let i = 0; i < 6; i++) {
    vec[(base + i) % EMBED_DIMS] = 2.0 + rng() * 0.5;
  }
  // Per-note noise for intra-topic spread
  for (let i = 0; i < EMBED_DIMS; i++) {
    vec[i] = (vec[i] ?? 0) + (rng() - 0.5) * 0.3;
  }
  return normalize(vec);
}

/**
 * Topic centroid embedding for a query.
 * topicIndex = -1 produces a multi-topic average vector.
 */
function pseudoEmbedQuery(topicIndex: number): number[] {
  const vec: number[] = new Array(EMBED_DIMS).fill(0) as number[];
  if (topicIndex >= 0) {
    const base = (topicIndex * 6) % EMBED_DIMS;
    for (let i = 0; i < 6; i++) {
      vec[(base + i) % EMBED_DIMS] = 2.0;
    }
  } else {
    // Multi-hop: activate all topic regions equally
    for (let t = 0; t < 10; t++) {
      const base = (t * 6) % EMBED_DIMS;
      for (let i = 0; i < 6; i++) {
        vec[(base + i) % EMBED_DIMS] = (vec[(base + i) % EMBED_DIMS] ?? 0) + 0.2;
      }
    }
  }
  return normalize(vec);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManifestEntry {
  id: string;
  topicIndex: number;
  topicName: string;
  type: string;
  category: string;
  title: string;
  tags: string[];
  created: string;
  updated: string;
}

interface BenchQuery {
  id: string;
  query: string;
  queryType: 'keyword' | 'semantic' | 'temporal' | 'multi-hop' | 'needle-in-haystack';
  expectedNoteIds: string[];
  temporalTopNote?: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Null markdown storage — benchmark notes live in SQLite only
// ---------------------------------------------------------------------------

const nullMarkdownStorage: MarkdownStorage = {
  save: (_meta: NoteMetadata, _content: string): string => '',
  read: (_filePath: string): Note | undefined => undefined,
  readById: (_id: string): Note | undefined => undefined,
  update: (_filePath: string, _meta: Partial<NoteMetadata>, _content?: string): Note => {
    throw new Error('Not implemented in benchmark');
  },
  remove: (_filePath: string): void => { /* noop */ },
  moveToTrash: (_filePath: string): string => '',
  restoreFromTrash: (_trashFilePath: string, _originalFilePath: string): void => { /* noop */ },
  purge: (_filePath: string): void => { /* noop */ },
  list: (): Note[] => [],
  registerFile: (): void => { /* noop */ },
  unregisterFile: (): void => { /* noop */ },
};

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface QueryResult {
  queryId: string;
  queryType: string;
  pipeline: PipelineName;
  scale: Scale;
  precision5: number;
  recall10: number;
  mrr: number;
  latencyMs: number;
  returnedIds: string[];
}

export interface PipelineSummary {
  pipeline: PipelineName;
  scale: Scale;
  avgPrecision5: number;
  avgRecall10: number;
  avgMrr: number;
  medianLatencyMs: number;
  queryCount: number;
}

export interface BenchmarkResults {
  timestamp: string;
  scales: Scale[];
  pipelines: PipelineName[];
  queryCount: number;
  queryResults: QueryResult[];
  summaries: PipelineSummary[];
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function precisionAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  const top = retrieved.slice(0, k);
  return top.filter((id) => relevant.has(id)).length / k;
}

function recallAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0;
  const top = retrieved.slice(0, k);
  return top.filter((id) => relevant.has(id)).length / relevant.size;
}

function meanReciprocalRank(retrieved: string[], relevant: Set<string>): number {
  for (let i = 0; i < retrieved.length; i++) {
    if (relevant.has(retrieved[i]!)) return 1 / (i + 1);
  }
  return 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

// ---------------------------------------------------------------------------
// Load corpus into temporary databases
// ---------------------------------------------------------------------------

interface TempDatabases {
  sqlite: ReturnType<typeof createSqliteStorage>;
  vectorDb: Awaited<ReturnType<typeof createVectorStorage>>;
  dir: string;
  /** Map from topicIndex → sorted list of note IDs for this scale */
  topicToIds: Map<number, string[]>;
  /** Map from note title → note ID for needle queries */
  titleToId: Map<string, string>;
}

async function loadCorpus(scale: Scale): Promise<TempDatabases> {
  const fixtureDir = join(__dirname, 'fixtures', scale);
  const manifestPath = join(fixtureDir, 'manifest.json');

  if (!existsSync(manifestPath)) {
    throw new Error(
      `Corpus fixture missing for scale "${scale}". Run: pnpm tsx benchmarks/search/generate-corpus.ts ${scale}`,
    );
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ManifestEntry[];

  const dir = join(tmpdir(), `echos-bench-${scale}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  const sqlite = createSqliteStorage(join(dir, 'bench.db'), silentLogger);

  const vectorDocs: Array<{ id: string; text: string; vector: number[]; type: string; title: string }> = [];

  for (const entry of manifest) {
    let content = `${entry.title}. This note covers ${entry.topicName} concepts.`;

    const noteFile = join(fixtureDir, `${entry.id}.md`);
    if (existsSync(noteFile)) {
      const raw = readFileSync(noteFile, 'utf-8');
      const bodyMatch = /^---[\s\S]*?---\s*([\s\S]*)/.exec(raw);
      content = bodyMatch?.[1]?.trim() ?? content;
    }

    const meta: NoteMetadata = {
      id: entry.id,
      type: entry.type as NoteMetadata['type'],
      title: entry.title,
      created: entry.created,
      updated: entry.updated,
      tags: entry.tags,
      links: [],
      category: entry.category,
    };

    sqlite.upsertNote(meta, content, `${entry.id}.md`);
    vectorDocs.push({ id: entry.id, text: content.slice(0, 500), vector: pseudoEmbedNote(entry.topicIndex, entry.id), type: entry.type, title: entry.title });
  }

  // Single-batch LanceDB insert (vastly faster than N individual upserts for large corpora)
  const vectorDb = await createVectorStorageBulk(join(dir, 'lance'), vectorDocs, silentLogger, EMBED_DIMS);

  // Build topic → ID mapping for scale-aware expected ID resolution
  const topicToIds = new Map<number, string[]>();
  const titleToId = new Map<string, string>();
  for (const entry of manifest) {
    const list = topicToIds.get(entry.topicIndex) ?? [];
    list.push(entry.id);
    topicToIds.set(entry.topicIndex, list);
    titleToId.set(entry.title, entry.id);
  }

  return { sqlite, vectorDb, dir, topicToIds, titleToId };
}

function cleanupCorpus(dbs: TempDatabases): void {
  dbs.sqlite.close();
  dbs.vectorDb.close();
  rmSync(dbs.dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Run all queries for one pipeline configuration
// ---------------------------------------------------------------------------

function guessTopicFromExpected(expectedNoteIds: string[]): number {
  if (expectedNoteIds.length === 0) return -1;
  const firstId = expectedNoteIds[0]!;
  const numStr = firstId.replace(/^bench-[sml]-0*/, '');
  const num = parseInt(numStr, 10);
  if (!Number.isFinite(num) || num < 1) return -1;
  return Math.floor((num - 1) / 10); // 10 notes per topic in small corpus
}

/**
 * Translate small-corpus expected IDs to current scale's IDs.
 *
 * - For topic/semantic queries (many expected IDs): returns ALL notes in the
 *   relevant topic(s) from the current scale.
 * - For needle queries (1 expected ID): uses the title lookup to find the
 *   matching note in the current scale.
 */
function translateExpected(
  q: BenchQuery,
  dbs: TempDatabases,
): string[] {
  const isNeedle = q.queryType === 'needle-in-haystack';

  if (isNeedle && q.expectedNoteIds.length === 1) {
    // The small-corpus title is the same structure across scales — look it up
    // by scanning titleToId for a title that ends with the same suffix as the query.
    const queryWords = q.query.trim().toLowerCase();
    for (const [title, id] of dbs.titleToId) {
      if (title.toLowerCase().includes(queryWords.split(' ').slice(0, 2).join(' '))) {
        return [id];
      }
    }
    // Fallback: try direct title match from small-corpus note ID
    return [];
  }

  // For non-needle queries: gather all note IDs across the relevant topics
  const topicIndex = guessTopicFromExpected(q.expectedNoteIds);

  if (topicIndex >= 0) {
    return dbs.topicToIds.get(topicIndex) ?? [];
  }

  // Multi-hop: collect topics from all expected IDs (may span 2 topics)
  const topics = new Set<number>();
  for (const id of q.expectedNoteIds) {
    const numStr = id.replace(/^bench-[sml]-0*/, '');
    const num = parseInt(numStr, 10);
    if (Number.isFinite(num) && num >= 1) {
      topics.add(Math.floor((num - 1) / 10));
    }
  }
  const ids: string[] = [];
  for (const t of topics) {
    ids.push(...(dbs.topicToIds.get(t) ?? []));
  }
  return ids;
}

async function runPipeline(
  pipeline: PipelineName,
  queries: BenchQuery[],
  scale: Scale,
  dbs: TempDatabases,
  anthropicApiKey: string | undefined,
): Promise<QueryResult[]> {
  const searchService = createSearchService(
    dbs.sqlite,
    dbs.vectorDb,
    nullMarkdownStorage,
    silentLogger,
    anthropicApiKey ? { anthropicApiKey } : {},
  );

  const results: QueryResult[] = [];

  for (const q of queries) {
    const resolvedExpected = translateExpected(q, dbs);
    const relevant = new Set(resolvedExpected);
    const topicIndex = guessTopicFromExpected(q.expectedNoteIds);
    const queryVector = pseudoEmbedQuery(topicIndex);

    if (pipeline === 'hybrid+decay+hotness+rerank' && !anthropicApiKey) {
      results.push({ queryId: q.id, queryType: q.queryType, pipeline, scale, precision5: -1, recall10: -1, mrr: -1, latencyMs: -1, returnedIds: [] });
      continue;
    }

    const start = performance.now();
    let returnedIds: string[] = [];

    try {
      if (pipeline === 'keyword-only') {
        returnedIds = searchService.keyword({ query: q.query, limit: 10 }).map((r) => r.note.metadata.id);
      } else if (pipeline === 'semantic-only') {
        returnedIds = (await searchService.semantic({ query: q.query, vector: queryVector, limit: 10 })).map((r) => r.note.metadata.id);
      } else if (pipeline === 'hybrid') {
        returnedIds = (await searchService.hybrid({ query: q.query, vector: queryVector, limit: 10, temporalDecay: false, hotnessBoost: false })).map((r) => r.note.metadata.id);
      } else if (pipeline === 'hybrid+decay') {
        returnedIds = (await searchService.hybrid({ query: q.query, vector: queryVector, limit: 10, temporalDecay: true, hotnessBoost: false })).map((r) => r.note.metadata.id);
      } else if (pipeline === 'hybrid+decay+hotness') {
        returnedIds = (await searchService.hybrid({ query: q.query, vector: queryVector, limit: 10, temporalDecay: true, hotnessBoost: true })).map((r) => r.note.metadata.id);
      } else if (pipeline === 'hybrid+decay+hotness+rerank') {
        returnedIds = (await searchService.hybrid({ query: q.query, vector: queryVector, limit: 10, temporalDecay: true, hotnessBoost: true, rerank: true })).map((r) => r.note.metadata.id);
      }
    } catch (err: unknown) {
      process.stderr.write(`warn: query ${q.id} pipeline ${pipeline} failed: ${String(err)}\n`);
    }

    const latencyMs = performance.now() - start;
    results.push({ queryId: q.id, queryType: q.queryType, pipeline, scale, precision5: precisionAtK(returnedIds, relevant, 5), recall10: recallAtK(returnedIds, relevant, 10), mrr: meanReciprocalRank(returnedIds, relevant), latencyMs, returnedIds });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Summarise per pipeline × scale
// ---------------------------------------------------------------------------

function summarise(results: QueryResult[]): PipelineSummary[] {
  const grouped = new Map<string, QueryResult[]>();
  for (const r of results) {
    const key = `${r.pipeline}__${r.scale}`;
    const g = grouped.get(key) ?? [];
    g.push(r);
    grouped.set(key, g);
  }

  const summaries: PipelineSummary[] = [];
  for (const [key, group] of grouped) {
    const parts = key.split('__');
    const pipeline = parts[0] as PipelineName;
    const scale = parts[1] as Scale;
    const valid = group.filter((r) => r.latencyMs >= 0);

    if (valid.length === 0) {
      summaries.push({ pipeline, scale, avgPrecision5: -1, avgRecall10: -1, avgMrr: -1, medianLatencyMs: -1, queryCount: 0 });
      continue;
    }

    summaries.push({
      pipeline,
      scale,
      avgPrecision5: valid.reduce((s, r) => s + r.precision5, 0) / valid.length,
      avgRecall10: valid.reduce((s, r) => s + r.recall10, 0) / valid.length,
      avgMrr: valid.reduce((s, r) => s + r.mrr, 0) / valid.length,
      medianLatencyMs: median(valid.map((r) => r.latencyMs)),
      queryCount: valid.length,
    });
  }

  return summaries.sort((a, b) => {
    if (a.scale !== b.scale) return SCALES.indexOf(a.scale) - SCALES.indexOf(b.scale);
    return PIPELINE_NAMES.indexOf(a.pipeline) - PIPELINE_NAMES.indexOf(b.pipeline);
  });
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { scales: Scale[]; pipelines: PipelineName[]; queryLimit: number } {
  const argv = process.argv.slice(2);
  let scales: Scale[] = [...SCALES];
  let pipelines: PipelineName[] = [...PIPELINE_NAMES];
  let queryLimit = Infinity;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--scale' && argv[i + 1]) {
      const val = argv[++i]!;
      scales = val === 'all' ? [...SCALES] : [val as Scale];
    } else if (arg === '--config' && argv[i + 1]) {
      pipelines = [argv[++i]! as PipelineName];
    } else if (arg === '--limit' && argv[i + 1]) {
      queryLimit = parseInt(argv[++i]!, 10);
    }
  }

  return { scales, pipelines, queryLimit };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { scales, pipelines, queryLimit } = parseArgs();
  const anthropicApiKey = process.env['ANTHROPIC_API_KEY'];

  const allQueries = JSON.parse(readFileSync(join(__dirname, 'queries.json'), 'utf-8')) as BenchQuery[];
  const queries = Number.isFinite(queryLimit) ? allQueries.slice(0, queryLimit) : allQueries;

  console.log(`\nEchOS Search Benchmark`);
  console.log(`Scales: ${scales.join(', ')} | Configs: ${pipelines.length} | Queries: ${queries.length}`);
  if (!anthropicApiKey) console.log(`Note: ANTHROPIC_API_KEY not set — rerank config will be skipped`);
  console.log('');

  const allResults: QueryResult[] = [];

  for (const scale of scales) {
    process.stdout.write(`Loading corpus: ${scale}...`);
    let dbs: TempDatabases | undefined;
    try {
      dbs = await loadCorpus(scale);
      console.log(` done`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`\n  ✗ ${msg}`);
      continue;
    }

    for (const pipeline of pipelines) {
      if (pipeline === 'hybrid+decay+hotness+rerank' && !anthropicApiKey) {
        console.log(`  [${scale}] ${pipeline.padEnd(32)} SKIPPED (no ANTHROPIC_API_KEY)`);
        continue;
      }

      const start = Date.now();
      const results = await runPipeline(pipeline, queries, scale, dbs, anthropicApiKey);
      const elapsed = Date.now() - start;

      allResults.push(...results);

      const valid = results.filter((r) => r.latencyMs >= 0);
      const avgP5 = valid.reduce((s, r) => s + r.precision5, 0) / (valid.length || 1);
      const avgMrr = valid.reduce((s, r) => s + r.mrr, 0) / (valid.length || 1);
      const medLat = median(valid.map((r) => r.latencyMs));

      console.log(
        `  [${scale}] ${pipeline.padEnd(32)} P@5=${avgP5.toFixed(3)}  MRR=${avgMrr.toFixed(3)}  lat=${medLat.toFixed(1)}ms  (${elapsed}ms total)`,
      );
    }

    cleanupCorpus(dbs);
    console.log('');
  }

  const summaries = summarise(allResults);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  const output: BenchmarkResults = {
    timestamp,
    scales,
    pipelines,
    queryCount: queries.length,
    queryResults: allResults,
    summaries,
  };

  const resultsDir = join(__dirname, 'results');
  mkdirSync(resultsDir, { recursive: true });
  const outPath = join(resultsDir, `${timestamp}.json`);
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(`Results saved: ${outPath}`);
  console.log('Run `pnpm tsx benchmarks/search/report.ts` to generate RESULTS.md\n');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
