import type { Logger } from 'pino';

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_DIMENSIONS = 1536;
const FETCH_TIMEOUT_MS = 30_000;

/** Models that support the OpenAI `dimensions` parameter for truncation */
const DIMENSION_TRUNCATION_MODELS = new Set(['text-embedding-3-small', 'text-embedding-3-large']);

export interface EmbeddingOptions {
  openaiApiKey: string | undefined;
  model?: string | undefined;
  /** Output vector dimensions. Must match LanceDB schema. text-embedding-3-* models support truncation via the OpenAI API. */
  dimensions?: number | undefined;
  logger: Logger;
}

/**
 * Create an embedding function that calls the OpenAI embeddings API.
 * Falls back to a zero-vector stub if no API key is provided.
 *
 * Set `dimensions` to control the output size. For text-embedding-3-* models
 * the OpenAI API truncates server-side. This value must match `createVectorStorage`.
 */
export function createEmbeddingFn(
  options?: Partial<EmbeddingOptions>,
): (text: string) => Promise<number[]> {
  const dimensions = options?.dimensions ?? DEFAULT_DIMENSIONS;

  if (!options?.openaiApiKey) {
    options?.logger?.warn('No OpenAI API key — embeddings disabled (zero-vector stub)');
    return async (_text: string) => new Array(dimensions).fill(0);
  }

  const { openaiApiKey, logger } = options;
  const model = options.model ?? DEFAULT_MODEL;

  // Build request body — include `dimensions` param for models that support truncation
  const supportsTruncation = DIMENSION_TRUNCATION_MODELS.has(model);

  if (!supportsTruncation && dimensions !== DEFAULT_DIMENSIONS) {
    logger?.warn(
      { model, dimensions },
      `Model "${model}" does not support the dimensions parameter. Output dimension depends on the model itself. Ensure it matches EMBEDDING_DIMENSIONS.`,
    );
  }

  return async (text: string): Promise<number[]> => {
    // Truncate to avoid token limits (roughly 8191 tokens ~ 32k chars)
    const truncated = text.slice(0, 30_000);

    const body: Record<string, unknown> = {
      model,
      input: truncated,
    };
    if (supportsTruncation) {
      body['dimensions'] = dimensions;
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger?.error({ status: response.status, error: errorText }, 'OpenAI embeddings API error');
      throw new Error(`OpenAI embeddings API error: ${response.status}`);
    }

    const result = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    const embedding = result.data[0]?.embedding;
    if (!embedding || embedding.length === 0) {
      throw new Error('Empty embedding returned from OpenAI');
    }

    if (embedding.length !== dimensions) {
      throw new Error(
        `Embedding dimension mismatch: got ${embedding.length}, expected ${dimensions}. Check EMBEDDING_DIMENSIONS matches your model.`,
      );
    }

    logger?.debug(
      { model, textLength: truncated.length, dimensions: embedding.length },
      'Embedding generated',
    );
    return embedding;
  };
}
