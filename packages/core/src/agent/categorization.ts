/**
 * AI-powered categorization and summarization service.
 * Provides both lightweight (category + tags) and full processing (category + tags + summary + key points + gist).
 */

import type { Logger } from 'pino';
import { streamSimple, getModel, parseStreamingJson } from '@mariozechner/pi-ai';

/**
 * Categorization result (lightweight mode)
 */
export interface CategorizationResult {
  category: string;
  tags: string[];
}

/**
 * Full processing result (includes summary and gist)
 */
export interface FullProcessingResult extends CategorizationResult {
  gist: string;
  summary: string;
  keyPoints: string[];
}

/**
 * Processing modes
 */
export type ProcessingMode = 'lightweight' | 'full';

const MODEL_ID = 'claude-3-5-haiku-20241022';

/**
 * Generate lightweight categorization (category + tags only)
 */
export async function categorizeLightweight(
  title: string,
  content: string,
  apiKey: string,
  logger: Logger,
  onProgress?: (message: string) => void,
): Promise<CategorizationResult> {
  logger.debug({ title }, 'Starting lightweight categorization');

  const prompt = `Analyze the following content and provide categorization in JSON format:

Title: ${title}

Content:
${content.slice(0, 5000)}

Please categorize this content with:
1. A single, concise category (e.g., "programming", "health", "finance", "personal", "work")
2. 3-5 relevant tags for organization and searchability

Respond with a JSON object in this exact format:
{
  "category": "your category here",
  "tags": ["tag1", "tag2", "tag3"]
}`;

  try {
    const model = getModel('anthropic', MODEL_ID as 'claude-3-5-haiku-20241022');
    const stream = streamSimple(
      model,
      { messages: [{ role: 'user', content: prompt, timestamp: Date.now() }] },
      { apiKey, maxTokens: 500 },
    );

    let accumulated = '';
    let lastCategory = '';
    let lastTagCount = 0;

    for await (const event of stream) {
      if (event.type === 'text_delta') {
        accumulated += event.delta;
        const partial = parseStreamingJson<Partial<CategorizationResult>>(accumulated);

        if (partial.category && partial.category !== lastCategory) {
          lastCategory = partial.category;
          onProgress?.(`Category: ${partial.category}`);
        }
        if (partial.tags && partial.tags.length > lastTagCount) {
          lastTagCount = partial.tags.length;
          onProgress?.(`Tags: ${partial.tags.filter(Boolean).join(', ')}`);
        }
      }
    }

    const jsonMatch = accumulated.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : '{}';
    const result = JSON.parse(jsonStr) as CategorizationResult;

    logger.info(
      { category: result.category, tags: result.tags },
      'Lightweight categorization complete',
    );

    return {
      category: result.category || 'uncategorized',
      tags: Array.isArray(result.tags) ? result.tags : [],
    };
  } catch (error) {
    logger.error({ error }, 'Categorization failed');
    return {
      category: 'uncategorized',
      tags: [],
    };
  }
}

/**
 * Generate full processing (category + tags + summary + key points + gist)
 */
export async function processFull(
  title: string,
  content: string,
  apiKey: string,
  logger: Logger,
  onProgress?: (message: string) => void,
): Promise<FullProcessingResult> {
  logger.debug({ title }, 'Starting full content processing');

  const prompt = `Analyze the following content thoroughly and provide comprehensive processing in JSON format:

Title: ${title}

Content:
${content.slice(0, 10000)}

Please provide:
1. A single, concise category (e.g., "programming", "health", "finance", "personal", "work")
2. 3-5 relevant tags for organization and searchability
3. A one-sentence gist (max 100 characters) that captures the essence
4. A comprehensive summary (2-3 paragraphs) covering the main ideas and insights
5. 3-5 key takeaways or actionable points from the content

Respond with a JSON object in this exact format:
{
  "category": "your category here",
  "tags": ["tag1", "tag2", "tag3"],
  "gist": "one sentence summary under 100 chars",
  "summary": "2-3 paragraph comprehensive summary...",
  "keyPoints": ["point 1", "point 2", "point 3"]
}`;

  try {
    const model = getModel('anthropic', MODEL_ID as 'claude-3-5-haiku-20241022');
    const stream = streamSimple(
      model,
      { messages: [{ role: 'user', content: prompt, timestamp: Date.now() }] },
      { apiKey, maxTokens: 2000 },
    );

    let accumulated = '';
    let lastCategory = '';
    let lastTagCount = 0;
    let lastGist = '';

    for await (const event of stream) {
      if (event.type === 'text_delta') {
        accumulated += event.delta;
        const partial = parseStreamingJson<Partial<FullProcessingResult>>(accumulated);

        if (partial.category && partial.category !== lastCategory) {
          lastCategory = partial.category;
          onProgress?.(`Category: ${partial.category}`);
        }
        if (partial.tags && partial.tags.length > lastTagCount) {
          lastTagCount = partial.tags.length;
          onProgress?.(`Tags: ${partial.tags.filter(Boolean).join(', ')}`);
        }
        // Only surface gist once it looks complete (ends with punctuation or is long enough)
        if (
          partial.gist &&
          partial.gist !== lastGist &&
          partial.gist.length > 20 &&
          /[.!?]$/.test(partial.gist)
        ) {
          lastGist = partial.gist;
          onProgress?.(`Gist: ${partial.gist}`);
        }
      }
    }

    const jsonMatch = accumulated.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : '{}';
    const result = JSON.parse(jsonStr) as FullProcessingResult;

    logger.info(
      { category: result.category, tags: result.tags, gist: result.gist },
      'Full processing complete',
    );

    return {
      category: result.category || 'uncategorized',
      tags: Array.isArray(result.tags) ? result.tags : [],
      gist: result.gist || title.slice(0, 100),
      summary: result.summary || content.slice(0, 500),
      keyPoints: Array.isArray(result.keyPoints) ? result.keyPoints : [],
    };
  } catch (error) {
    logger.error({ error }, 'Full processing failed');
    return {
      category: 'uncategorized',
      tags: [],
      gist: title.slice(0, 100),
      summary: content.slice(0, 500),
      keyPoints: [],
    };
  }
}

/**
 * Main categorization function with mode selection
 */
export async function categorizeContent(
  title: string,
  content: string,
  mode: ProcessingMode,
  apiKey: string,
  logger: Logger,
  onProgress?: (message: string) => void,
): Promise<CategorizationResult | FullProcessingResult> {
  if (mode === 'lightweight') {
    return categorizeLightweight(title, content, apiKey, logger, onProgress);
  } else {
    return processFull(title, content, apiKey, logger, onProgress);
  }
}
