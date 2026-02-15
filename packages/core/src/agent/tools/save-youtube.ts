import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { v4 as uuidv4 } from 'uuid';
import type { NoteMetadata } from '@echos/shared';
import { processYoutube } from '../../processors/youtube.js';
import type { SqliteStorage } from '../../storage/sqlite.js';
import type { MarkdownStorage } from '../../storage/markdown.js';
import type { VectorStorage } from '../../storage/vectordb.js';
import type { Logger } from 'pino';

export interface SaveYoutubeToolDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
  vectorDb: VectorStorage;
  generateEmbedding: (text: string) => Promise<number[]>;
  logger: Logger;
}

const schema = Type.Object({
  url: Type.String({ description: 'YouTube video URL' }),
  tags: Type.Optional(Type.Array(Type.String(), { description: 'Tags for the video' })),
  category: Type.Optional(Type.String({ description: 'Category' })),
});

type Params = Static<typeof schema>;

export function saveYoutubeTool(deps: SaveYoutubeToolDeps): AgentTool<typeof schema> {
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

      const processed = await processYoutube(params.url, deps.logger);

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

      const filePath = deps.markdown.save(metadata, processed.content);
      deps.sqlite.upsertNote(metadata, processed.content, filePath);

      if (processed.embedText) {
        try {
          const vector = await deps.generateEmbedding(processed.embedText);
          await deps.vectorDb.upsert({
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
