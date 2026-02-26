import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { v4 as uuidv4 } from 'uuid';
import type { NoteMetadata } from '@echos/shared';
import type { PluginContext } from '@echos/core';
import { categorizeContent, type ProcessingMode } from '@echos/core';
import { processTweet } from './processor.js';

const schema = Type.Object({
  url: Type.String({ description: 'Twitter/X URL of the tweet or thread to save', format: 'uri' }),
  tags: Type.Optional(Type.Array(Type.String(), { description: 'Tags for the tweet' })),
  category: Type.Optional(Type.String({ description: 'Category for the tweet', default: 'tweets' })),
  autoCategorize: Type.Optional(
    Type.Boolean({
      description: 'Automatically categorize using AI (default: true)',
      default: true,
    }),
  ),
  processingMode: Type.Optional(
    Type.Union([Type.Literal('lightweight'), Type.Literal('full')], {
      description:
        'AI processing mode: "lightweight" (category+tags) or "full" (includes summary, gist, key points). Only used if autoCategorize is true.',
      default: 'full',
    }),
  ),
});

type Params = Static<typeof schema>;

export function createSaveTweetTool(context: PluginContext): AgentTool<typeof schema> {
  return {
    name: 'save_tweet',
    label: 'Save Tweet',
    description:
      'Save a tweet or thread from Twitter/X. Extracts content via FxTwitter API — supports twitter.com and x.com URLs. Threads by the same author are automatically unrolled into a clean article. Always auto-categorizes with AI by default. Say "saved to your reading list" — not "added to your knowledge base".',
    parameters: schema,
    execute: async (_toolCallId, params: Params, _signal, onUpdate) => {
      onUpdate?.({
        content: [{ type: 'text', text: `Fetching tweet from ${params.url}...` }],
        details: { phase: 'fetching' },
      });

      let processed;
      try {
        processed = await processTweet(params.url, context.logger);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        context.logger.error({ error, url: params.url }, 'save_tweet failed');
        throw new Error(`Failed to fetch tweet: ${message}`);
      }

      const now = new Date().toISOString();
      const id = uuidv4();

      let category = params.category ?? 'tweets';
      let tags = params.tags ?? [];
      let gist: string | undefined;

      // Auto-categorize if requested and API key available
      if ((params.autoCategorize ?? true) && context.config.anthropicApiKey) {
        onUpdate?.({
          content: [{ type: 'text', text: 'Categorizing tweet with AI...' }],
          details: { phase: 'categorizing' },
        });

        try {
          const mode: ProcessingMode = params.processingMode ?? 'full';
          const result = await categorizeContent(
            processed.title,
            processed.content,
            mode,
            context.config.anthropicApiKey as string,
            context.logger,
            (message) =>
              onUpdate?.({
                content: [{ type: 'text', text: message }],
                details: { phase: 'categorizing' },
              }),
            context.config.defaultModel as string,
          );

          category = result.category;
          tags = result.tags;

          if ('gist' in result) {
            gist = result.gist;
          }

          context.logger.info({ category, tags, mode }, 'Tweet auto-categorized');
        } catch (error) {
          context.logger.error({ error }, 'Auto-categorization failed, using defaults');
        }
      }

      const metadata: NoteMetadata = {
        id,
        type: 'tweet',
        title: processed.title,
        created: now,
        updated: now,
        tags,
        links: [],
        category,
        sourceUrl: params.url,
        status: 'saved',
        inputSource: 'url',
      };
      if (processed.metadata.author) metadata.author = processed.metadata.author;
      if (gist) metadata.gist = gist;

      const filePath = context.markdown.save(metadata, processed.content);
      context.sqlite.upsertNote(metadata, processed.content, filePath);

      if (processed.embedText) {
        try {
          const vector = await context.generateEmbedding(processed.embedText);
          await context.vectorDb.upsert({
            id,
            text: processed.embedText,
            vector,
            type: 'tweet',
            title: processed.title,
          });
        } catch {
          // Non-fatal
        }
      }

      let responseText = `Saved tweet "${processed.title}" to your reading list (id: ${id})\n`;
      responseText += `Source: ${params.url}\n`;
      responseText += `Content: ${processed.content.length} characters\n`;
      responseText += `Category: ${category}\n`;
      responseText += `Tags: [${tags.join(', ')}]\n`;
      responseText += `Status: saved (mark as read when you've engaged with it)`;
      if (gist) {
        responseText += `\nGist: ${gist}`;
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: responseText,
          },
        ],
        details: { id, filePath, title: processed.title, category, tags },
      };
    },
  };
}
