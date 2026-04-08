#!/usr/bin/env tsx
/**
 * EchOS Search Benchmark Report Generator
 *
 * Reads the latest results JSON from benchmarks/search/results/ and generates
 * a human-readable RESULTS.md with comparison tables and delta analysis.
 *
 * Usage:
 *   tsx benchmarks/search/report.ts           # generates report from latest run
 *   tsx benchmarks/search/report.ts <path>    # generates report from specific JSON
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BenchmarkResults, ConfigResult } from './run.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, 'results');
const REPORT_PATH = join(__dirname, 'RESULTS.md');

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function pct(v: number, decimals = 1): string {
  return `${(v * 100).toFixed(decimals)}%`;
}

function ms(v: number): string {
  return `${v.toFixed(1)}ms`;
}

function delta(base: number, compared: number): string {
  const diff = compared - base;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${(diff * 100).toFixed(1)}pp`;
}

function tableRow(...cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function tableSeparator(cols: number): string {
  return `|${Array(cols).fill('---').join('|')}|`;
}

function buildScaleTable(configs: ConfigResult[], baseline: string = 'keyword'): string {
  const headers = ['Config', 'P@5', 'R@10', 'MRR', 'Median Latency', 'ΔP@5 vs keyword', 'ΔMRR vs keyword'];
  const baseConfig = configs.find((c) => c.config === baseline);

  const lines: string[] = [
    tableRow(...headers),
    tableSeparator(headers.length),
  ];

  for (const cr of configs) {
    const a = cr.aggregated;
    const deltaP5 = baseConfig
      ? delta(baseConfig.aggregated.meanPrecisionAt5, a.meanPrecisionAt5)
      : 'n/a';
    const deltaMrr = baseConfig
      ? delta(baseConfig.aggregated.meanMrr, a.meanMrr)
      : 'n/a';

    lines.push(
      tableRow(
        `\`${cr.config}\``,
        pct(a.meanPrecisionAt5),
        pct(a.meanRecallAt10),
        pct(a.meanMrr),
        ms(a.medianLatencyMs),
        cr.config === baseline ? '—' : deltaP5,
        cr.config === baseline ? '—' : deltaMrr,
      ),
    );
  }

  return lines.join('\n');
}

function buildQueryTypeTable(configs: ConfigResult[]): string {
  const allTypes = new Set<string>();
  for (const cr of configs) {
    for (const t of Object.keys(cr.aggregated.byQueryType)) {
      allTypes.add(t);
    }
  }

  const types = [...allTypes].sort();
  const lines: string[] = [];

  for (const qtype of types) {
    lines.push(`\n**${qtype} queries:**\n`);
    const headers = ['Config', 'P@5', 'R@10', 'MRR', 'Queries'];
    lines.push(tableRow(...headers));
    lines.push(tableSeparator(headers.length));
    for (const cr of configs) {
      const s = cr.aggregated.byQueryType[qtype];
      if (!s) continue;
      lines.push(
        tableRow(
          `\`${cr.config}\``,
          pct(s.meanPrecisionAt5),
          pct(s.meanRecallAt10),
          pct(s.meanMrr),
          String(s.count),
        ),
      );
    }
  }

  return lines.join('\n');
}

function buildKeyFindings(results: BenchmarkResults): string {
  const findings: string[] = [];

  for (const scaleResult of results.scales) {
    const keyword = scaleResult.configs.find((c) => c.config === 'keyword');
    const semantic = scaleResult.configs.find((c) => c.config === 'semantic');
    const hybrid = scaleResult.configs.find((c) => c.config === 'hybrid');
    const hybridDecay = scaleResult.configs.find((c) => c.config === 'hybrid+decay');
    const hybridHotness = scaleResult.configs.find((c) => c.config === 'hybrid+decay+hotness');
    const rerank = scaleResult.configs.find((c) => c.config === 'hybrid+decay+hotness+rerank');

    if (!keyword) continue;

    const scaleLabel = `[${scaleResult.scale}]`;

    if (hybrid) {
      const p5Gain = (hybrid.aggregated.meanPrecisionAt5 - keyword.aggregated.meanPrecisionAt5) * 100;
      if (p5Gain > 0) {
        findings.push(
          `- ${scaleLabel} Hybrid search improves P@5 by **+${p5Gain.toFixed(1)}pp** vs keyword-only`,
        );
      } else {
        findings.push(
          `- ${scaleLabel} Hybrid search P@5 vs keyword-only: ${p5Gain >= 0 ? '+' : ''}${p5Gain.toFixed(1)}pp`,
        );
      }
    }

    if (semantic) {
      const mrrGain = (semantic.aggregated.meanMrr - keyword.aggregated.meanMrr) * 100;
      findings.push(
        `- ${scaleLabel} Semantic search MRR vs keyword-only: ${mrrGain >= 0 ? '+' : ''}${mrrGain.toFixed(1)}pp`,
      );
    }

    if (hybridDecay && hybrid) {
      const decayGain = (hybridDecay.aggregated.meanPrecisionAt5 - hybrid.aggregated.meanPrecisionAt5) * 100;
      findings.push(
        `- ${scaleLabel} Temporal decay adds ${decayGain >= 0 ? '+' : ''}${decayGain.toFixed(1)}pp P@5 over plain hybrid`,
      );
    }

    if (hybridHotness && hybridDecay) {
      const hotnessGain = (hybridHotness.aggregated.meanPrecisionAt5 - hybridDecay.aggregated.meanPrecisionAt5) * 100;
      findings.push(
        `- ${scaleLabel} Hotness boost adds ${hotnessGain >= 0 ? '+' : ''}${hotnessGain.toFixed(1)}pp P@5 over hybrid+decay`,
      );
    }

    if (rerank && hybridHotness) {
      const rerankGain = (rerank.aggregated.meanPrecisionAt5 - hybridHotness.aggregated.meanPrecisionAt5) * 100;
      findings.push(
        `- ${scaleLabel} Reranking adds ${rerankGain >= 0 ? '+' : ''}${rerankGain.toFixed(1)}pp P@5 over hybrid+decay+hotness (${ms(rerank.aggregated.medianLatencyMs)} latency)`,
      );
    }
  }

  return findings.length > 0 ? findings.join('\n') : '- No findings (run with more scales for comparison)';
}

export function generateReport(results: BenchmarkResults): string {
  const runDate = new Date(results.timestamp).toUTCString();

  const sections: string[] = [
    `# EchOS Search Benchmark Results`,
    '',
    `> **Generated:** ${runDate}`,
    `> **Embedding strategy:** ${results.meta.embeddingStrategy} (${results.meta.vectorDimensions}d)`,
    `> **Query count:** ${results.meta.queryCount}`,
    `> **Reranking:** ${results.meta.rerankEnabled ? 'enabled' : 'disabled'}`,
    '',
    '## Key Findings',
    '',
    buildKeyFindings(results),
    '',
    '---',
    '',
  ];

  for (const scaleResult of results.scales) {
    sections.push(`## Scale: ${scaleResult.scale} (${scaleResult.noteCount.toLocaleString()} notes)`);
    sections.push('');
    sections.push('### Configuration Comparison');
    sections.push('');
    sections.push(buildScaleTable(scaleResult.configs));
    sections.push('');
    sections.push('### Results by Query Type');
    sections.push('');
    sections.push(buildQueryTypeTable(scaleResult.configs));
    sections.push('');
    sections.push('---');
    sections.push('');
  }

  sections.push('## Configuration Descriptions');
  sections.push('');
  sections.push('| Config | Description |');
  sections.push('|--------|-------------|');
  sections.push('| `keyword` | FTS5 full-text search only (BM25 ranking) |');
  sections.push('| `semantic` | Vector search only (cosine similarity) |');
  sections.push('| `hybrid` | RRF fusion of FTS + vector results |');
  sections.push('| `hybrid+decay` | Hybrid + exponential temporal decay (90-day half-life) |');
  sections.push('| `hybrid+decay+hotness` | Hybrid + decay + retrieval-frequency boost (hotness) |');
  sections.push('| `hybrid+decay+hotness+rerank` | Full pipeline + Claude cross-encoder reranking |');
  sections.push('');
  sections.push('## Metric Definitions');
  sections.push('');
  sections.push('| Metric | Description |');
  sections.push('|--------|-------------|');
  sections.push('| **P@5** | Precision@5: fraction of top-5 results that are relevant |');
  sections.push('| **R@10** | Recall@10: fraction of expected relevant docs found in top-10 |');
  sections.push('| **MRR** | Mean Reciprocal Rank: 1/rank of first relevant result |');
  sections.push('| **Latency** | Median search time (wall-clock, including SQLite + vector DB) |');
  sections.push('');
  sections.push('## Notes');
  sections.push('');
  sections.push('- Embeddings are deterministic hash-based vectors (no OpenAI API required)');
  sections.push('- Corpus is synthetic and reproducible (seeded PRNG, seed=42)');
  sections.push('- Temporal decay uses the note\'s `created` timestamp with 90-day half-life');
  sections.push('- Reranking uses Claude Haiku as a cross-encoder (requires `ANTHROPIC_API_KEY`)');

  const report = sections.join('\n');
  writeFileSync(REPORT_PATH, report, 'utf-8');
  return REPORT_PATH;
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

function findLatestResults(): string | null {
  if (!existsSync(RESULTS_DIR)) return null;
  const files = readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();
  return files[0] ? join(RESULTS_DIR, files[0]) : null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const jsonPath = process.argv[2] ?? findLatestResults();
  if (!jsonPath) {
    console.error('No results found. Run pnpm bench:search first.');
    process.exit(1);
  }

  console.log(`Reading results from: ${jsonPath}`);
  const results: BenchmarkResults = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  const outPath = generateReport(results);
  console.log(`Report written to: ${outPath}`);
}
