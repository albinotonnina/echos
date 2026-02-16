import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { v4 as uuidv4 } from 'uuid';
import type { NoteMetadata } from '@echos/shared';
import type { PluginContext } from '@echos/core';
import { categorizeContent, type ProcessingMode } from '@echos/core';
import { processArticle } from './processor.js';

const schema = Type.Object({
  url: Type.String({ description: 'URL of the article to save', format: 'uri' }),
  tags: Type.Optional(Type.Array(Type.String(), { description: 'Tags for the article' })),
  category: Type.Optional(Type.String({ description: 'Category for the article' })),
  autoCategorize: Type.Optional(
    Type.Boolean({
      description: 'Automatically categorize using AI (default: false)',
      default: false,
    }),
  ),
  processingMode: Type.Optional(
    Type.Union([Type.Literal('lightweight'), Type.Literal('full')], {
      description: 'AI processing mode: "lightweight" (category+tags) or "full" (includes summary, gist, key points). Only used if autoCategorize is true.',
      default: 'full',
    }),
  ),
});

type Params = Static<typeof schema>;

export function createSaveArticleTool(
  context: PluginContext,
): AgentTool<typeof schema> {
  return {
    name: 'save_article',
    label: 'Save Article',
    description:
      'Fetch, extract, and save a web article. Extracts content using Readability. Optionally auto-categorize with AI.',
    parameters: schema,
    execute: async (_toolCallId, params: Params, _signal, onUpdate) => {
      onUpdate?.({
        content: [{ type: 'text', text: `Fetching article from ${params.url}...` }],
        details: { phase: 'fetching' },
      });

      const processed = await processArticle(params.url, context.logger);

      const now = new Date().toISOString();
      const id = uuidv4();

      let category = params.category ?? 'articles';
      let tags = params.tags ?? [];
      let gist: string | undefined;

      // Auto-categorize if requested and API key available
      if (params.autoCategorize && context.config.anthropicApiKey) {
        onUpdate?.({
          content: [{ type: 'text', text: 'Categorizing article with AI...' }],
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
          );

          category = result.category;
          tags = result.tags;

          if ('gist' in result) {
            gist = result.gist;
          }

          context.logger.info(
            { category, tags, mode },
            'Article auto-categorized',
          );
        } catch (error) {
          context.logger.error({ error }, 'Auto-categorization failed, using defaults');
        }
      }

      const metadata: NoteMetadata = {
        id,
        type: 'article',
        title: processed.title,
        created: now,
        updated: now,
        tags,
        links: [],
        category,
        sourceUrl: params.url,
        gist,
      };
      if (processed.metadata.author) metadata.author = processed.metadata.author;

      const filePath = context.markdown.save(metadata, processed.content);
      context.sqlite.upsertNote(metadata, processed.content, filePath);

      if (processed.embedText) {
        try {
          const vector = await context.generateEmbedding(processed.embedText);
          await context.vectorDb.upsert({
            id,
            text: processed.embedText,
            vector,
            type: 'article',
            title: processed.title,
          });
        } catch {
          // Non-fatal
        }
      }

      let responseText = `Saved article "${processed.title}" (id: ${id})\n`;
      responseText += `Source: ${params.url}\n`;
      responseText += `Content: ${processed.content.length} characters\n`;
      responseText += `Category: ${category}\n`;
      responseText += `Tags: [${tags.join(', ')}]`;
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
