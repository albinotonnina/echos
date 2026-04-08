#!/usr/bin/env tsx
/**
 * EchOS Search Benchmark Runner
 *
 * For each corpus scale × pipeline configuration, loads the synthetic corpus
 * into a temporary SQLite + LanceDB instance, runs all test queries, and
 * computes Precision@5, Recall@10, MRR, and median latency.
 *
 * Deterministic embeddings: uses a hash-based bag-of-words embedding that
 * produces reproducible vectors without requiring an API key. Similar-topic
 * notes have similar vectors; different-topic notes have dissimilar vectors.
 *
 * Usage:
 *   pnpm bench:search                    # all scales
 *   pnpm bench:search --scale small      # single scale
 *   pnpm bench:search --rerank           # enable reranking (needs ANTHROPIC_API_KEY)
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { createSqliteStorage } from '@echos/core/storage/sqlite.js';
import { createVectorStorage } from '@echos/core/storage/vectordb.js';
import { createSearchService } from '@echos/core/storage/search.js';
import { createLogger } from '@echos/shared/logging/index.js';
import type { ContentType, Note } from '@echos/shared';
import type { CorpusIndex } from './generate-corpus.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');
const RESULTS_DIR = join(__dirname, 'results');

const ARGS = process.argv.slice(2);
const SCALE_FILTER = ARGS[ARGS.indexOf('--scale') + 1] as string | undefined;
const ENABLE_RERANK = ARGS.includes('--rerank');
const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY'];

const SCALES = ['small', 'medium', 'large'].filter(
  (s) => !SCALE_FILTER || s === SCALE_FILTER,
);

const VECTOR_DIMENSIONS = 128; // Reduced dimensions for fast benchmark embedding
const DEFAULT_LIMIT = 20; // Number of results to fetch per query

// ---------------------------------------------------------------------------
// Deterministic hash-based embedding (no API key required)
//
// Each word maps to a fixed pseudo-random unit vector via its hash.
// A document embedding = normalized sum of its word vectors.
// Notes with overlapping vocabulary have high cosine similarity.
// ---------------------------------------------------------------------------

/** LCG PRNG seeded with a 32-bit integer */
function seededRng(seed: number): () => number {
  let s = (seed >>> 0) + 1; // ensure non-zero
  return (): number => {
    s = Math.imul(s, 1664525) + 1013904223;
    return ((s >>> 0) / 0x100000000) * 2 - 1; // range [-1, 1]
  };
}

/** Map a string to a stable 32-bit integer hash (FNV-1a) */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic embedding for a text string */
function embed(text: string, dims: number = VECTOR_DIMENSIONS): number[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const vec = new Array<number>(dims).fill(0);

  for (const token of tokens) {
    const hash = fnv1a(token);
    const rng = seededRng(hash);
    for (let d = 0; d < dims; d++) {
      vec[d]! += rng();
    }
  }

  // L2 normalize
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

// ---------------------------------------------------------------------------
// IR metrics
// ---------------------------------------------------------------------------

/** Precision@K: fraction of top-K results that are relevant */
function precisionAtK(results: string[], relevant: Set<string>, k: number): number {
  const top = results.slice(0, k);
  const hits = top.filter((id) => relevant.has(id)).length;
  return top.length === 0 ? 0 : hits / top.length;
}

/** Recall@K: fraction of relevant docs found in top-K */
function recallAtK(results: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0;
  const top = results.slice(0, k);
  const hits = top.filter((id) => relevant.has(id)).length;
  return hits / relevant.size;
}

/** Mean Reciprocal Rank: 1/rank of first relevant result (0 if none found) */
function reciprocalRank(results: string[], relevant: Set<string>): number {
  for (let i = 0; i < results.length; i++) {
    if (relevant.has(results[i]!)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

// ---------------------------------------------------------------------------
// Pipeline configuration types
// ---------------------------------------------------------------------------

type PipelineConfig =
  | { name: 'keyword' }
  | { name: 'semantic' }
  | { name: 'hybrid' }
  | { name: 'hybrid+decay' }
  | { name: 'hybrid+decay+rerank' };

const BASE_CONFIGS: PipelineConfig[] = [
  { name: 'keyword' },
  { name: 'semantic' },
  { name: 'hybrid' },
  { name: 'hybrid+decay' },
];

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface QueryResult {
  queryId: string;
  query: string;
  queryType: string;
  resultIds: string[];
  relevantIds: string[];
  precisionAt5: number;
  recallAt10: number;
  mrr: number;
  latencyMs: number;
}

export interface ConfigResult {
  config: string;
  queries: QueryResult[];
  aggregated: {
    meanPrecisionAt5: number;
    meanRecallAt10: number;
    meanMrr: number;
    medianLatencyMs: number;
    byQueryType: Record<
      string,
      { meanPrecisionAt5: number; meanRecallAt10: number; meanMrr: number; count: number }
    >;
  };
}

export interface ScaleResult {
  scale: string;
  noteCount: number;
  configs: ConfigResult[];
}

export interface BenchmarkResults {
  timestamp: string;
  scales: ScaleResult[];
  meta: {
    vectorDimensions: number;
    queryCount: number;
    embeddingStrategy: string;
    rerankEnabled: boolean;
  };
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

interface TestQuery {
  id: string;
  query: string;
  expectedNoteIds: string[];
  queryType: string;
}

async function runScaleBenchmark(scaleName: string): Promise<ScaleResult> {
  const indexPath = join(FIXTURES_DIR, scaleName, 'notes-index.json');
  if (!existsSync(indexPath)) {
    console.log(`  [${scaleName}] Fixtures missing — generating corpus...`);
    execSync(`tsx ${join(__dirname, 'generate-corpus.ts')}`, { stdio: 'inherit' });
  }

  const index: CorpusIndex = JSON.parse(readFileSync(indexPath, 'utf-8'));
  const queries: TestQuery[] = JSON.parse(
    readFileSync(join(__dirname, 'queries.json'), 'utf-8'),
  );

  console.log(
    `\n  [${scaleName}] ${index.noteCount} notes, ${queries.length} queries`,
  );

  // Filter queries to only those whose expectedNoteIds exist in this corpus
  const noteIdSet = new Set(index.notes.map((n) => n.id));
  const validQueries = queries.filter((q) =>
    q.expectedNoteIds.some((id) => noteIdSet.has(id)),
  );
  console.log(
    `  [${scaleName}] ${validQueries.length} queries valid for this scale`,
  );

  // Create temp storage directories
  const tmpBase = join(tmpdir(), `echos-bench-${scaleName}-${Date.now()}`);
  const sqlitePath = join(tmpBase, 'bench.db');
  const lancePath = join(tmpBase, 'lancedb');
  mkdirSync(tmpBase, { recursive: true });

  const logger = createLogger('bench');
  const sqlite = createSqliteStorage(sqlitePath, logger);
  const vectorDb = await createVectorStorage(lancePath, logger, {
    dimensions: VECTOR_DIMENSIONS,
  });

  // Index all notes
  console.log(`  [${scaleName}] Indexing notes...`);
  const t0 = Date.now();
  for (const note of index.notes) {
    const embedText = `${note.title} ${note.content}`;
    const vector = embed(embedText);

    sqlite.upsertNote(
      {
        id: note.id,
        type: note.type as ContentType,
        title: note.title,
        created: note.created,
        updated: note.updated,
        tags: note.tags,
        links: [],
        category: note.category,
      },
      note.content,
      `/bench/${note.id}.md`,
    );

    await vectorDb.upsert({
      id: note.id,
      text: note.content.slice(0, 500),
      vector,
      type: note.type,
      title: note.title,
    });
  }
  console.log(`  [${scaleName}] Indexed in ${Date.now() - t0}ms`);

  // Build search service
  const searchService = createSearchService(
    sqlite,
    vectorDb,
    // Minimal MarkdownStorage: benchmark reads from SQLite only (files are in /bench/ which don't exist)
    // The search service falls back to SQLite content when the file is missing, which is acceptable here
    {
      read: (_fp: string): Note | undefined => undefined,
      save: (): string => '',
      readById: (_id: string): Note | undefined => undefined,
      update: (): Note => { throw new Error('not implemented'); },
      remove: (_fp: string): void => undefined,
      moveToTrash: (_fp: string): string => '',
      restoreFromTrash: (_trash: string, _orig: string): void => undefined,
      purge: (_fp: string): void => undefined,
      list: (): Note[] => [],
      registerFile: (_id: string, _fp: string): void => undefined,
      unregisterFile: (_fp: string): void => undefined,
    },
    logger,
    ENABLE_RERANK && ANTHROPIC_API_KEY ? { anthropicApiKey: ANTHROPIC_API_KEY } : {},
  );

  // Determine configs to test
  const configs: PipelineConfig[] = [...BASE_CONFIGS];
  if (ENABLE_RERANK && ANTHROPIC_API_KEY) {
    configs.push({ name: 'hybrid+decay+rerank' });
  }

  // Run benchmarks for each config
  const configResults: ConfigResult[] = [];

  for (const config of configs) {
    console.log(`  [${scaleName}] Running config: ${config.name}`);
    const queryResults: QueryResult[] = [];

    for (const q of validQueries) {
      const relevant = new Set(q.expectedNoteIds.filter((id) => noteIdSet.has(id)));
      if (relevant.size === 0) continue;

      const queryVector = embed(q.query);
      const tStart = performance.now();

      let resultIds: string[] = [];

      if (config.name === 'keyword') {
        const rows = sqlite.searchFts(q.query, { limit: DEFAULT_LIMIT });
        resultIds = rows.map((r) => r.id);
      } else if (config.name === 'semantic') {
        const results = await vectorDb.search(queryVector, DEFAULT_LIMIT);
        resultIds = results.map((r) => r.id);
      } else if (config.name === 'hybrid') {
        const results = await searchService.hybrid({
          query: q.query,
          vector: queryVector,
          limit: DEFAULT_LIMIT,
          temporalDecay: false,
          rerank: false,
        });
        resultIds = results.map((r) => r.note.metadata.id);
      } else if (config.name === 'hybrid+decay') {
        const results = await searchService.hybrid({
          query: q.query,
          vector: queryVector,
          limit: DEFAULT_LIMIT,
          temporalDecay: true,
          decayHalfLifeDays: 90,
          rerank: false,
        });
        resultIds = results.map((r) => r.note.metadata.id);
      } else if (config.name === 'hybrid+decay+rerank') {
        const results = await searchService.hybrid({
          query: q.query,
          vector: queryVector,
          limit: DEFAULT_LIMIT,
          temporalDecay: true,
          decayHalfLifeDays: 90,
          rerank: true,
        });
        resultIds = results.map((r) => r.note.metadata.id);
      }

      const latencyMs = performance.now() - tStart;

      queryResults.push({
        queryId: q.id,
        query: q.query,
        queryType: q.queryType,
        resultIds,
        relevantIds: [...relevant],
        precisionAt5: precisionAtK(resultIds, relevant, 5),
        recallAt10: recallAtK(resultIds, relevant, 10),
        mrr: reciprocalRank(resultIds, relevant),
        latencyMs,
      });
    }

    // Aggregate metrics
    const mean = (vals: number[]): number =>
      vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length;

    const byType: Record<string, { p: number[]; r: number[]; mrr: number[] }> = {};
    for (const qr of queryResults) {
      const t = qr.queryType;
      if (!byType[t]) byType[t] = { p: [], r: [], mrr: [] };
      byType[t]!.p.push(qr.precisionAt5);
      byType[t]!.r.push(qr.recallAt10);
      byType[t]!.mrr.push(qr.mrr);
    }

    const byQueryType: ConfigResult['aggregated']['byQueryType'] = {};
    for (const [t, v] of Object.entries(byType)) {
      byQueryType[t] = {
        meanPrecisionAt5: mean(v.p),
        meanRecallAt10: mean(v.r),
        meanMrr: mean(v.mrr),
        count: v.p.length,
      };
    }

    configResults.push({
      config: config.name,
      queries: queryResults,
      aggregated: {
        meanPrecisionAt5: mean(queryResults.map((q) => q.precisionAt5)),
        meanRecallAt10: mean(queryResults.map((q) => q.recallAt10)),
        meanMrr: mean(queryResults.map((q) => q.mrr)),
        medianLatencyMs: median(queryResults.map((q) => q.latencyMs)),
        byQueryType,
      },
    });
  }

  // Cleanup
  sqlite.close();
  vectorDb.close();
  rmSync(tmpBase, { recursive: true, force: true });

  return {
    scale: scaleName,
    noteCount: index.noteCount,
    configs: configResults,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  mkdirSync(RESULTS_DIR, { recursive: true });

  console.log('EchOS Search Benchmark');
  console.log('======================');
  console.log(`Scales: ${SCALES.join(', ')}`);
  console.log(`Reranking: ${ENABLE_RERANK ? (ANTHROPIC_API_KEY ? 'enabled' : 'disabled (no API key)') : 'disabled'}`);
  console.log(`Vector dimensions: ${VECTOR_DIMENSIONS}`);
  console.log(`Embedding strategy: deterministic hash-based BoW\n`);

  const results: BenchmarkResults = {
    timestamp: new Date().toISOString(),
    scales: [],
    meta: {
      vectorDimensions: VECTOR_DIMENSIONS,
      queryCount: (JSON.parse(readFileSync(join(__dirname, 'queries.json'), 'utf-8')) as unknown[]).length,
      embeddingStrategy: 'deterministic-hash-bow',
      rerankEnabled: ENABLE_RERANK && !!ANTHROPIC_API_KEY,
    },
  };

  for (const scale of SCALES) {
    const scaleResult = await runScaleBenchmark(scale);
    results.scales.push(scaleResult);

    // Print summary table
    console.log(`\n  [${scale}] Results:`);
    console.log(`  ${'Config'.padEnd(25)} ${'P@5'.padEnd(8)} ${'R@10'.padEnd(8)} ${'MRR'.padEnd(8)} ${'Latency'.padEnd(10)}`);
    console.log(`  ${'-'.repeat(65)}`);
    for (const cr of scaleResult.configs) {
      const a = cr.aggregated;
      console.log(
        `  ${cr.config.padEnd(25)} ${pct(a.meanPrecisionAt5).padEnd(8)} ${pct(a.meanRecallAt10).padEnd(8)} ${pct(a.meanMrr).padEnd(8)} ${a.medianLatencyMs.toFixed(1)}ms`,
      );
    }
  }

  // Write results JSON
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = join(RESULTS_DIR, `${timestamp}.json`);
  writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\nResults written to: ${outPath}`);

  // Generate report
  const { generateReport } = await import('./report.js');
  const reportPath = generateReport(results);
  console.log(`Report written to: ${reportPath}`);
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

main().catch((err: unknown) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
