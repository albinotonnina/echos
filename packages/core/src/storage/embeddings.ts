import type { Logger } from 'pino';

export interface EmbeddingOptions {
  openaiApiKey: string;
  model?: string;
  logger: Logger;
}

/**
 * Create a real embedding function that calls the OpenAI embeddings API.
 * Falls back to a zero-vector stub if no API key is provided.
 */
export function createEmbeddingFn(
  options?: Partial<EmbeddingOptions>,
): (text: string) => Promise<number[]> {
  const DIMENSION = 1536;

  if (!options?.openaiApiKey) {
    options?.logger?.warn('No OpenAI API key — embeddings disabled (zero-vector stub)');
    return async (_text: string) => new Array(DIMENSION).fill(0);
  }

  const { openaiApiKey, logger } = options;
  const model = options.model ?? 'text-embedding-3-small';

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

    logger?.debug({ model, textLength: truncated.length, dimensions: embedding.length }, 'Embedding generated');
    return embedding;
  };
}
