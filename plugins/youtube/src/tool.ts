import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { v4 as uuidv4 } from 'uuid';
import type { NoteMetadata } from '@echos/shared';
import type { PluginContext } from '@echos/core';
import { processYoutube } from './processor.js';

const schema = Type.Object({
  url: Type.String({ description: 'YouTube video URL' }),
  tags: Type.Optional(Type.Array(Type.String(), { description: 'Tags for the video' })),
  category: Type.Optional(Type.String({ description: 'Category' })),
});

type Params = Static<typeof schema>;

export function createSaveYoutubeTool(
  context: PluginContext,
): AgentTool<typeof schema> {
  const openaiApiKey = context.config['openaiApiKey'] as string | undefined;

  return {
    name: 'save_youtube',
    label: 'Save YouTube',
    description: 'Save a YouTube video transcript. Extracts captions and saves as a note.',
    parameters: schema,
    execute: async (_toolCallId, params: Params, _signal, onUpdate) => {
      onUpdate?.({
        content: [{ type: 'text', text: `Fetching transcript for ${params.url}...` }],
        details: { phase: 'fetching' },
      });

      const processed = await processYoutube(params.url, context.logger, openaiApiKey);

      const now = new Date().toISOString();
      const id = uuidv4();

      const metadata: NoteMetadata = {
        id,
        type: 'youtube',
        title: processed.title,
        created: now,
        updated: now,
        tags: params.tags ?? [],
        links: [],
        category: params.category ?? 'videos',
        sourceUrl: params.url,
      };

      const filePath = context.markdown.save(metadata, processed.content);
      context.sqlite.upsertNote(metadata, processed.content, filePath);

      if (processed.embedText) {
        try {
          const vector = await context.generateEmbedding(processed.embedText);
          await context.vectorDb.upsert({
            id,
            text: processed.embedText,
            vector,
            type: 'youtube',
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
            text: `Saved YouTube video "${processed.title}" (id: ${id})\nTranscript: ${processed.content.length} characters`,
          },
        ],
        details: { id, filePath, title: processed.title },
      };
    },
  };
}
