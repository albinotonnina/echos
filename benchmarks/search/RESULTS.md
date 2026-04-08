# Search Benchmark Results

> Generated: 2026:04:08 18:35:28 | Scales: small | Queries: 55

## Summary: Hybrid vs Baselines

**small**: hybrid P@5=0.855 vs keyword=0.044 (✅ hybrid wins) vs semantic=0.825 (✅ hybrid wins)

## Temporal Decay Impact (MRR on temporal queries)

**small**: temporal MRR 1.000 → 1.000 after temporal decay (+0.000)

## Metrics by Scale

### Small Corpus

**All pipelines — average over all 55 queries:**

| Pipeline | P@5 | Δ vs keyword | Recall@10 | MRR | Latency |
|---|---|---|---|---|---|
| keyword-only | 0.044 | — | 0.169 | 0.200 | 0.1ms |
| semantic-only | 0.825 *(+0.782)* |  *(+0.782)* | 0.945 | 0.845 | 0.6ms |
| hybrid | 0.855 *(+0.811)* |  *(+0.811)* | 0.945 | 0.985 | 0.9ms |
| hybrid+decay | 0.491 *(+0.447)* |  *(+0.447)* | 0.536 | 0.856 | 0.9ms |
| hybrid+decay+hotness | 0.491 *(+0.447)* |  *(+0.447)* | 0.536 | 0.856 | 0.9ms |

**MRR by query type (hybrid vs keyword):**

| Query Type | keyword-only | hybrid | hybrid+decay |
|---|---|---|---|
| keyword | 0.000 | 1.000 | 1.000 |
| semantic | 0.000 | 1.000 | 1.000 |
| temporal | 0.286 | 1.000 | 1.000 |
| multi-hop | 0.000 | 1.000 | 1.000 |
| needle-in-haystack | 0.900 | 0.920 | 0.209 |

## Pipeline Configurations

| Config | Description |
|---|---|
| keyword-only | SQLite FTS5 full-text search only |
| semantic-only | LanceDB vector search only |
| hybrid | Reciprocal Rank Fusion (FTS + vector) |
| hybrid+decay | hybrid + exponential temporal decay (90-day half-life) |
| hybrid+decay+hotness | hybrid+decay + sigmoid hotness boost from access frequency |
| hybrid+decay+hotness+rerank | full pipeline + Claude cross-encoder reranking |

## Reproducibility

This benchmark uses **deterministic pseudo-embeddings** — no OpenAI API key required.
Embeddings are generated from topic cluster assignments, ensuring the same corpus
produces identical results on every run.

To regenerate the corpus: `pnpm tsx benchmarks/search/generate-corpus.ts all`
To run the benchmark: `pnpm bench:search`
To update this report: `pnpm tsx benchmarks/search/report.ts`

