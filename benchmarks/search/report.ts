#!/usr/bin/env tsx
/**
 * Search Benchmark Report Generator (task 10.04)
 *
 * Reads the latest results JSON and generates:
 *   - benchmarks/search/RESULTS.md  — comparison tables + delta analysis
 *
 * Usage:
 *   pnpm tsx benchmarks/search/report.ts [path/to/results.json]
 *
 * If no path is given, loads the most recently modified file in
 * benchmarks/search/results/.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BenchmarkResults, PipelineSummary } from './run.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Load results
// ---------------------------------------------------------------------------

function latestResultsPath(): string {
  const resultsDir = join(__dirname, 'results');
  if (!existsSync(resultsDir)) {
    throw new Error(`No results directory found. Run: pnpm bench:search`);
  }
  // Files are named {ISO-timestamp}.json; lexicographic sort == chronological sort.
  const files = readdirSync(resultsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) throw new Error('No result files found. Run: pnpm bench:search');
  return join(resultsDir, files[0]!);
}

function loadResults(pathArg?: string): BenchmarkResults {
  const p = pathArg ?? latestResultsPath();
  return JSON.parse(readFileSync(p, 'utf-8')) as BenchmarkResults;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmt(value: number, decimals = 3): string {
  if (value < 0) return 'N/A';
  return value.toFixed(decimals);
}

function fmtMs(value: number): string {
  if (value < 0) return 'N/A';
  return `${value.toFixed(1)}ms`;
}

function deltaStr(base: number, current: number): string {
  if (base < 0 || current < 0) return '';
  const d = current - base;
  if (Math.abs(d) < 0.001) return '';
  const sign = d > 0 ? '+' : '';
  return ` *(${sign}${d.toFixed(3)})*`;
}

// ---------------------------------------------------------------------------
// Table generation
// ---------------------------------------------------------------------------

const PIPELINE_ORDER = [
  'keyword-only',
  'semantic-only',
  'hybrid',
  'hybrid+decay',
  'hybrid+decay+hotness',
  'hybrid+decay+hotness+rerank',
];

function metricsTable(summaries: PipelineSummary[], scale: string): string {
  const rows = PIPELINE_ORDER
    .map((p) => summaries.find((s) => s.pipeline === p && s.scale === scale))
    .filter(Boolean) as PipelineSummary[];

  if (rows.length === 0) return '_No data for this scale._\n';

  // Use keyword-only as the baseline for delta analysis
  const baseline = rows.find((r) => r.pipeline === 'keyword-only');

  const header = '| Pipeline | P@5 | Δ vs keyword | Recall@10 | MRR | Latency |';
  const sep    = '|---|---|---|---|---|---|';

  const lines = rows.map((r) => {
    const p5Delta = baseline ? deltaStr(baseline.avgPrecision5, r.avgPrecision5) : '';
    return `| ${r.pipeline} | ${fmt(r.avgPrecision5)}${p5Delta} | ${p5Delta || '—'} | ${fmt(r.avgRecall10)} | ${fmt(r.avgMrr)} | ${fmtMs(r.medianLatencyMs)} |`;
  });

  return [header, sep, ...lines].join('\n') + '\n';
}

function queryTypeTable(summaries: PipelineSummary[], scale: string, results: BenchmarkResults): string {
  const queryTypes = ['keyword', 'semantic', 'temporal', 'multi-hop', 'needle-in-haystack'];
  const pipelines = ['keyword-only', 'hybrid', 'hybrid+decay'];

  const header = `| Query Type | ${pipelines.join(' | ')} |`;
  const sep = `|---|${pipelines.map(() => '---').join('|')}|`;

  const lines = queryTypes.map((qt) => {
    const cells = pipelines.map((p) => {
      const typeResults = results.queryResults.filter(
        (r) => r.scale === scale && r.pipeline === p && r.queryType === qt && r.latencyMs >= 0,
      );
      if (typeResults.length === 0) return 'N/A';
      const avgMrr = typeResults.reduce((s, r) => s + r.mrr, 0) / typeResults.length;
      return fmt(avgMrr);
    });
    return `| ${qt} | ${cells.join(' | ')} |`;
  });

  return [header, sep, ...lines].join('\n') + '\n';
}

function hybridVsBaselinesSection(summaries: PipelineSummary[]): string {
  const lines: string[] = [];

  for (const scale of ['small', 'medium', 'large']) {
    const kw = summaries.find((s) => s.pipeline === 'keyword-only' && s.scale === scale);
    const sem = summaries.find((s) => s.pipeline === 'semantic-only' && s.scale === scale);
    const hyb = summaries.find((s) => s.pipeline === 'hybrid' && s.scale === scale);

    if (!kw || !sem || !hyb) continue;

    const hybBeatsKw = hyb.avgPrecision5 >= kw.avgPrecision5;
    const hybBeatsSem = hyb.avgPrecision5 >= sem.avgPrecision5;

    lines.push(
      `**${scale}**: hybrid P@5=${fmt(hyb.avgPrecision5)} vs keyword=${fmt(kw.avgPrecision5)} (${hybBeatsKw ? '✅ hybrid wins' : '⚠️ keyword wins'}) vs semantic=${fmt(sem.avgPrecision5)} (${hybBeatsSem ? '✅ hybrid wins' : '⚠️ semantic wins'})`,
    );
  }

  return lines.join('\n') + '\n';
}

function decayImpactSection(summaries: PipelineSummary[], results: BenchmarkResults): string {
  const lines: string[] = [];

  for (const scale of results.scales) {
    // Compute MRR specifically for temporal queries so the comparison is meaningful.
    const temporalMrr = (pipeline: string): number => {
      const rows = results.queryResults.filter(
        (r) => r.scale === scale && r.pipeline === pipeline && r.queryType === 'temporal' && r.latencyMs >= 0,
      );
      if (rows.length === 0) return -1;
      return rows.reduce((s, r) => s + r.mrr, 0) / rows.length;
    };

    const hybMrr = temporalMrr('hybrid');
    const decayMrr = temporalMrr('hybrid+decay');
    if (hybMrr < 0 || decayMrr < 0) continue;

    const delta = decayMrr - hybMrr;
    lines.push(
      `**${scale}**: temporal MRR ${fmt(hybMrr)} → ${fmt(decayMrr)} after temporal decay (${delta >= 0 ? '+' : ''}${delta.toFixed(3)})`,
    );
  }

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Full report
// ---------------------------------------------------------------------------

function generateReport(results: BenchmarkResults): string {
  const ts = results.timestamp.replace('T', ' ').slice(0, 19);

  const sections: string[] = [];

  sections.push(`# Search Benchmark Results`);
  sections.push(`\n> Generated: ${ts} | Scales: ${results.scales.join(', ')} | Queries: ${results.queryCount}\n`);

  sections.push(`## Summary: Hybrid vs Baselines\n`);
  sections.push(hybridVsBaselinesSection(results.summaries));

  sections.push(`## Temporal Decay Impact (MRR on temporal queries)\n`);
  sections.push(decayImpactSection(results.summaries, results));

  sections.push(`## Metrics by Scale\n`);

  for (const scale of results.scales) {
    sections.push(`### ${scale.charAt(0).toUpperCase() + scale.slice(1)} Corpus\n`);
    sections.push(`**All pipelines — average over all ${results.queryCount} queries:**\n`);
    sections.push(metricsTable(results.summaries, scale));

    sections.push(`**MRR by query type (hybrid vs keyword):**\n`);
    sections.push(queryTypeTable(results.summaries, scale, results));
  }

  sections.push(`## Pipeline Configurations\n`);
  sections.push(`| Config | Description |`);
  sections.push(`|---|---|`);
  sections.push(`| keyword-only | SQLite FTS5 full-text search only |`);
  sections.push(`| semantic-only | LanceDB vector search only |`);
  sections.push(`| hybrid | Reciprocal Rank Fusion (FTS + vector) |`);
  sections.push(`| hybrid+decay | hybrid + exponential temporal decay (90-day half-life) |`);
  sections.push(`| hybrid+decay+hotness | hybrid+decay + sigmoid hotness boost from access frequency |`);
  sections.push(`| hybrid+decay+hotness+rerank | full pipeline + Claude cross-encoder reranking |`);
  sections.push(``);

  sections.push(`## Reproducibility\n`);
  sections.push(`This benchmark uses **deterministic pseudo-embeddings** — no OpenAI API key required.`);
  sections.push(`Embeddings are generated from topic cluster assignments, ensuring the same corpus`);
  sections.push(`produces identical results on every run.\n`);
  sections.push(`To regenerate the corpus: \`pnpm tsx benchmarks/search/generate-corpus.ts all\``);
  sections.push(`To run the benchmark: \`pnpm bench:search\``);
  sections.push(`To update this report: \`pnpm tsx benchmarks/search/report.ts\``);
  sections.push(``);

  return sections.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const pathArg = process.argv[2];
const results = loadResults(pathArg);
const report = generateReport(results);

const outPath = join(__dirname, 'RESULTS.md');
writeFileSync(outPath, report);
console.log(`Report written: ${outPath}`);
