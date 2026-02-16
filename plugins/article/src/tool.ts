import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { v4 as uuidv4 } from 'uuid';
import type { NoteMetadata } from '@echos/shared';
import type { PluginContext } from '@echos/core';
import { processArticle } from './processor.js';

const schema = Type.Object({
  url: Type.String({ description: 'URL of the article to save', format: 'uri' }),
  tags: Type.Optional(Type.Array(Type.String(), { description: 'Tags for the article' })),
  category: Type.Optional(Type.String({ description: 'Category for the article' })),
});

type Params = Static<typeof schema>;

export function createSaveArticleTool(
  context: PluginContext,
): AgentTool<typeof schema> {
  return {
    name: 'save_article',
    label: 'Save Article',
    description: 'Fetch, extract, and save a web article. Extracts content using Readability.',
    parameters: schema,
    execute: async (_toolCallId, params: Params, _signal, onUpdate) => {
      onUpdate?.({
        content: [{ type: 'text', text: `Fetching article from ${params.url}...` }],
        details: { phase: 'fetching' },
      });

      const processed = await processArticle(params.url, context.logger);

      const now = new Date().toISOString();
      const id = uuidv4();

      const metadata: NoteMetadata = {
        id,
        type: 'article',
        title: processed.title,
        created: now,
        updated: now,
        tags: params.tags ?? [],
        links: [],
        category: params.category ?? 'articles',
        sourceUrl: params.url,
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

      return {
        content: [
          {
            type: 'text' as const,
            text: `Saved article "${processed.title}" (id: ${id})\nSource: ${params.url}\nContent: ${processed.content.length} characters`,
          },
        ],
        details: { id, filePath, title: processed.title },
      };
    },
  };
}
