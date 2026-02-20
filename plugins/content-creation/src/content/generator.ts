import type { Logger } from 'pino';
import type { GeneratedContent, ContentGenerationParams, EnhancedStyleProfile } from '../types.js';
import type { RelevantNote } from './knowledge-retriever.js';
import { buildContentPrompt } from './prompt-builder.js';

export interface GenerationResult {
  content: GeneratedContent;
  tokensUsed?: {
    input: number;
    output: number;
  };
}

/**
 * Generate content using the LLM with style profile and knowledge context
 */
export async function generateContent(
  params: ContentGenerationParams,
  profile: EnhancedStyleProfile,
  relevantNotes: RelevantNote[],
  anthropicApiKey: string,
  logger: Logger,
  modelId: string,
): Promise<GenerationResult> {
  try {
    logger.info(
      {
        topic: params.topic,
        contentType: params.contentType,
        noteCount: relevantNotes.length,
      },
      'Generating content',
    );

    // Build the generation prompt
    const prompt = buildContentPrompt(params, profile, relevantNotes);

    logger.debug({ promptLength: prompt.length }, 'Built generation prompt');

    // Make direct API call to Anthropic
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${errorText}`);
    }

    const result = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    // Extract text content
    const generatedText = result.content
      .map((block) => (block.type === 'text' ? (block.text ?? '') : ''))
      .join('')
      .trim();

    if (!generatedText) {
      throw new Error('Generated content is empty');
    }

    logger.info(
      {
        contentLength: generatedText.length,
        wordCount: generatedText.split(/\s+/).length,
      },
      'Content generation complete',
    );

    // Extract token usage if available
    const tokensUsed = result.usage
      ? {
          input: result.usage.input_tokens,
          output: result.usage.output_tokens,
        }
      : undefined;

    const contentResult: GeneratedContent = {
      content: generatedText,
      contentType: params.contentType,
      topic: params.topic,
      sourceNotes: relevantNotes.map((n) => n.id),
      generatedAt: new Date().toISOString(),
    };

    // Add tokensUsed only if it exists
    if (tokensUsed) {
      contentResult.tokensUsed = tokensUsed;
    }

    const generationResult: GenerationResult = {
      content: contentResult,
    };

    if (tokensUsed) {
      generationResult.tokensUsed = tokensUsed;
    }

    return generationResult;
  } catch (error) {
    logger.error({ error, topic: params.topic }, 'Content generation failed');
    throw new Error(
      `Content generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
