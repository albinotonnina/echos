# Search Benchmark Results

> Generated: 2026:04:08 16:09:59 | Scales: small, medium, large | Queries: 55

## Summary: Hybrid vs Baselines

**small**: hybrid P@5=0.855 vs keyword=0.044 (✅ hybrid wins) vs semantic=0.825 (✅ hybrid wins)
**medium**: hybrid P@5=0.818 vs keyword=0.084 (✅ hybrid wins) vs semantic=0.818 (✅ hybrid wins)
**large**: hybrid P@5=0.811 vs keyword=0.153 (✅ hybrid wins) vs semantic=0.818 (⚠️ semantic wins)

## Temporal Decay Impact (MRR on temporal queries)

**small**: MRR 0.985 → 0.856 after temporal decay (-0.129)
**medium**: MRR 0.827 → 0.845 after temporal decay (+0.018)
**large**: MRR 0.827 → 0.827 after temporal decay (+0.000)

## Metrics by Scale

### Small Corpus

**All pipelines — average over all 55 queries:**

| Pipeline | P@5 | Δ vs keyword | Recall@10 | MRR | Latency |
|---|---|---|---|---|---|
| keyword-only | 0.044 | — | 0.169 | 0.200 | 0.1ms |
| semantic-only | 0.825 *(+0.782)* |  *(+0.782)* | 1.000 | 0.845 | 1.0ms |
| hybrid | 0.855 *(+0.811)* |  *(+0.811)* | 1.000 | 0.985 | 1.0ms |
| hybrid+decay | 0.484 *(+0.440)* |  *(+0.440)* | 0.562 | 0.856 | 1.2ms |
| hybrid+decay+hotness | 0.484 *(+0.440)* |  *(+0.440)* | 0.562 | 0.856 | 1.2ms |

**MRR by query type (hybrid vs keyword):**

| Query Type | keyword-only | hybrid | hybrid+decay |
|---|---|---|---|
| keyword | 0.000 | 1.000 | 1.000 |
| semantic | 0.000 | 1.000 | 1.000 |
| temporal | 0.286 | 1.000 | 1.000 |
| multi-hop | 0.000 | 1.000 | 1.000 |
| needle-in-haystack | 0.900 | 0.920 | 0.209 |

### Medium Corpus

**All pipelines — average over all 55 queries:**

| Pipeline | P@5 | Δ vs keyword | Recall@10 | MRR | Latency |
|---|---|---|---|---|---|
| keyword-only | 0.084 | — | 0.024 | 0.182 | 0.1ms |
| semantic-only | 0.818 *(+0.735)* |  *(+0.735)* | 0.082 | 0.818 | 1.1ms |
| hybrid | 0.818 *(+0.735)* |  *(+0.735)* | 0.100 | 0.827 | 2.4ms |
| hybrid+decay | 0.822 *(+0.738)* |  *(+0.738)* | 0.118 | 0.845 | 1.3ms |
| hybrid+decay+hotness | 0.822 *(+0.738)* |  *(+0.738)* | 0.118 | 0.845 | 1.4ms |

**MRR by query type (hybrid vs keyword):**

| Query Type | keyword-only | hybrid | hybrid+decay |
|---|---|---|---|
| keyword | 0.200 | 1.000 | 1.000 |
| semantic | 0.000 | 1.000 | 1.000 |
| temporal | 0.714 | 1.000 | 1.000 |
| multi-hop | 0.000 | 0.917 | 1.000 |
| needle-in-haystack | 0.100 | 0.100 | 0.150 |

### Large Corpus

**All pipelines — average over all 55 queries:**

| Pipeline | P@5 | Δ vs keyword | Recall@10 | MRR | Latency |
|---|---|---|---|---|---|
| keyword-only | 0.153 | — | 0.019 | 0.236 | 0.1ms |
| semantic-only | 0.818 *(+0.665)* |  *(+0.665)* | 0.008 | 0.818 | 1.0ms |
| hybrid | 0.811 *(+0.658)* |  *(+0.658)* | 0.026 | 0.827 | 1.4ms |
| hybrid+decay | 0.811 *(+0.658)* |  *(+0.658)* | 0.026 | 0.827 | 1.3ms |
| hybrid+decay+hotness | 0.815 *(+0.662)* |  *(+0.662)* | 0.026 | 0.836 | 1.3ms |

**MRR by query type (hybrid vs keyword):**

| Query Type | keyword-only | hybrid | hybrid+decay |
|---|---|---|---|
| keyword | 0.250 | 1.000 | 1.000 |
| semantic | 0.000 | 1.000 | 1.000 |
| temporal | 1.000 | 1.000 | 1.000 |
| multi-hop | 0.000 | 0.917 | 0.917 |
| needle-in-haystack | 0.100 | 0.100 | 0.100 |

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

