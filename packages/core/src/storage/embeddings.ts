import type { Logger } from 'pino';

/** Supported embedding models and their vector dimensions */
const SUPPORTED_MODELS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

const DEFAULT_MODEL = 'text-embedding-3-small';
const REQUIRED_DIMENSION = 1536;
const FETCH_TIMEOUT_MS = 30_000;

export interface EmbeddingOptions {
  openaiApiKey: string | undefined;
  model?: string | undefined;
  logger: Logger;
}

/**
 * Create a real embedding function that calls the OpenAI embeddings API.
 * Falls back to a zero-vector stub if no API key is provided.
 */
export function createEmbeddingFn(
  options?: Partial<EmbeddingOptions>,
): (text: string) => Promise<number[]> {
  if (!options?.openaiApiKey) {
    options?.logger?.warn('No OpenAI API key — embeddings disabled (zero-vector stub)');
    return async (_text: string) => new Array(REQUIRED_DIMENSION).fill(0);
  }

  const { openaiApiKey, logger } = options;
  const model = options.model ?? DEFAULT_MODEL;

  // Validate the model produces vectors matching our LanceDB schema (1536 dimensions)
  const expectedDim = SUPPORTED_MODELS[model];
  if (expectedDim !== undefined && expectedDim !== REQUIRED_DIMENSION) {
    throw new Error(
      `Embedding model "${model}" produces ${expectedDim}-dim vectors, but LanceDB requires ${REQUIRED_DIMENSION}. Use "${DEFAULT_MODEL}" or "text-embedding-ada-002".`,
    );
  }

  return async (text: string): Promise<number[]> => {
    // Truncate to avoid token limits (roughly 8191 tokens ~ 32k chars)
    const truncated = text.slice(0, 30_000);

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model,
        input: truncated,
      }),
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

    if (embedding.length !== REQUIRED_DIMENSION) {
      throw new Error(
        `Embedding dimension mismatch: got ${embedding.length}, expected ${REQUIRED_DIMENSION}`,
      );
    }

    logger?.debug(
      { model, textLength: truncated.length, dimensions: embedding.length },
      'Embedding generated',
    );
    return embedding;
  };
}
