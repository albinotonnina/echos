/**
 * AI-powered categorization and summarization service.
 * Provides both lightweight (category + tags) and full processing (category + tags + summary + key points + gist).
 */

import type { Logger } from 'pino';
import { getModel } from '@mariozechner/pi-ai';
import { z } from 'zod';

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

const lightweightSchema = z.object({
  category: z.string().describe('A concise category for the content (e.g., "programming", "health", "finance")'),
  tags: z.array(z.string()).describe('Relevant tags for categorization (3-5 tags)'),
});

const fullProcessingSchema = z.object({
  category: z.string().describe('A concise category for the content (e.g., "programming", "health", "finance")'),
  tags: z.array(z.string()).describe('Relevant tags for categorization (3-5 tags)'),
  gist: z.string().describe('A one-sentence summary (max 100 characters) capturing the essence'),
  summary: z.string().describe('A comprehensive summary of the content (2-3 paragraphs)'),
  keyPoints: z.array(z.string()).describe('3-5 key takeaways or main points from the content'),
});

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

  const prompt = `Analyze the following content and provide categorization:

Title: ${title}

Content:
${content.slice(0, 5000)}

Please categorize this content with:
1. A single, concise category (e.g., "programming", "health", "finance", "personal", "work")
2. 3-5 relevant tags for organization and searchability

Be specific and accurate. Choose categories and tags that would be useful for organizing a personal knowledge base.`;

  const model = getModel('anthropic', 'claude-sonnet-4-5-20250929', { apiKey });

  try {
    const result = await model.generateStructuredData(prompt, lightweightSchema);
    
    logger.info(
      { category: result.category, tags: result.tags },
      'Lightweight categorization complete',
    );

    return {
      category: result.category,
      tags: result.tags,
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

  const prompt = `Analyze the following content thoroughly and provide comprehensive processing:

Title: ${title}

Content:
${content.slice(0, 10000)}

Please provide:
1. A single, concise category (e.g., "programming", "health", "finance", "personal", "work")
2. 3-5 relevant tags for organization and searchability
3. A one-sentence gist (max 100 characters) that captures the essence
4. A comprehensive summary (2-3 paragraphs) covering the main ideas and insights
5. 3-5 key takeaways or actionable points from the content

Be thorough, accurate, and make the summary and key points practical for future reference.`;

  const model = getModel('anthropic', 'claude-sonnet-4-5-20250929', { apiKey });

  try {
    const result = await model.generateStructuredData(prompt, fullProcessingSchema);
    
    logger.info(
      { category: result.category, tags: result.tags, gist: result.gist },
      'Full processing complete',
    );

    return {
      category: result.category,
      tags: result.tags,
      gist: result.gist,
      summary: result.summary,
      keyPoints: result.keyPoints,
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
