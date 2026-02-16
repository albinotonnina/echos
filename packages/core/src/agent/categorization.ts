/**
 * AI-powered categorization and summarization service.
 * Provides both lightweight (category + tags) and full processing (category + tags + summary + key points + gist).
 */

import type { Logger } from 'pino';

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

/**
 * Generate lightweight categorization (category + tags only)
 */
export async function categorizeLightweight(
  title: string,
  content: string,
  apiKey: string,
  logger: Logger,
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
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { content: Array<{ type: string; text: string }> };
    const text = data.content[0]?.text ?? '{}';
    
    // Extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
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
    // Fallback to default categorization
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
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { content: Array<{ type: string; text: string }> };
    const text = data.content[0]?.text ?? '{}';
    
    // Extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
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
    // Fallback to default values
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
): Promise<CategorizationResult | FullProcessingResult> {
  if (mode === 'lightweight') {
    return categorizeLightweight(title, content, apiKey, logger);
  } else {
    return processFull(title, content, apiKey, logger);
  }
}
