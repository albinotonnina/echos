import type { Logger } from 'pino';
import type { SearchResult } from '@echos/shared';
import { streamSimple } from '@mariozechner/pi-ai';
import { resolveModel } from '../agent/model-resolver.js';

export interface RerankOptions {
  topK?: number;
  model?: string;
}

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_TOP_K = 20;
/** Max characters of note content to include in the reranking prompt */
const MAX_CONTENT_CHARS = 400;

function buildRerankPrompt(query: string, candidates: SearchResult[]): string {
  const items = candidates
    .map((r, i) => {
      const meta = r.note.metadata;
      const snippet = r.note.content.slice(0, MAX_CONTENT_CHARS).replace(/\n+/g, ' ');
      return `${i + 1}. Title: "${meta.title}"\n   Content: ${snippet}`;
    })
    .join('\n\n');

  return `Rate the relevance of each candidate to the query below. Return ONLY a JSON array of numbers (0-10), one per candidate, in the same order. No explanation.

Query: "${query}"

Candidates:
${items}

Respond with a JSON array only, e.g.: [8, 3, 9, 1, ...]`;
}

function parseScores(text: string, expectedCount: number): number[] | null {
  // Find first JSON array in the response
  const match = text.match(/\[[\d\s.,]+\]/);
  if (!match) return null;

  try {
    const parsed: unknown = JSON.parse(match[0]);
    if (!Array.isArray(parsed) || parsed.length !== expectedCount) return null;
    const scores = parsed.map((v) => (typeof v === 'number' ? v : parseFloat(String(v))));
    if (scores.some((s) => !Number.isFinite(s))) return null;
    return scores;
  } catch {
    return null;
  }
}

/**
 * Rerank search results using a Claude model as a cross-encoder.
 *
 * Takes up to `topK` candidates, scores them against the query, and re-sorts.
 * The remaining candidates (beyond topK) are appended in their original order.
 * On API failure, returns candidates in original order (graceful degradation).
 */
export async function rerank(
  query: string,
  candidates: SearchResult[],
  anthropicApiKey: string,
  logger: Logger,
  options: RerankOptions = {},
): Promise<SearchResult[]> {
  if (candidates.length === 0) return candidates;

  const topK = Math.min(options.topK ?? DEFAULT_TOP_K, candidates.length);
  const modelId = options.model ?? DEFAULT_MODEL;
  const toRerank = candidates.slice(0, topK);
  const remainder = candidates.slice(topK);

  const prompt = buildRerankPrompt(query, toRerank);
  const model = resolveModel(modelId);

  let responseText = '';
  try {
    const stream = streamSimple(
      model,
      { messages: [{ role: 'user', content: prompt, timestamp: Date.now() }] },
      { apiKey: anthropicApiKey, maxTokens: 256 },
    );

    for await (const event of stream) {
      if (event.type === 'text_delta') {
        responseText += event.delta;
      }
    }
  } catch (err: unknown) {
    logger.warn({ err, query, model: modelId }, 'Reranker API call failed — returning original order');
    return candidates;
  }

  const scores = parseScores(responseText, toRerank.length);
  if (!scores) {
    logger.warn({ query, response: responseText.slice(0, 200) }, 'Reranker response parse failed — returning original order');
    return candidates;
  }

  // Apply scores and re-sort the top-K slice
  const scored = toRerank.map((r, i) => ({ result: r, rerankScore: scores[i]! }));
  scored.sort((a, b) => b.rerankScore - a.rerankScore);

  return [...scored.map((s) => s.result), ...remainder];
}
