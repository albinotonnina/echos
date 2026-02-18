import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { v4 as uuidv4 } from 'uuid';
import type { NoteMetadata } from '@echos/shared';
import type { SqliteStorage } from '../../storage/sqlite.js';
import type { MarkdownStorage } from '../../storage/markdown.js';
import type { VectorStorage } from '../../storage/vectordb.js';

export interface SaveConversationToolDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
  vectorDb: VectorStorage;
  generateEmbedding: (text: string) => Promise<number[]>;
}

const schema = Type.Object({
  title: Type.String({ description: 'A concise title for this conversation', minLength: 1 }),
  summary: Type.String({
    description: 'Agent-composed summary of the key insights from the current conversation',
    minLength: 1,
  }),
  tags: Type.Optional(Type.Array(Type.String(), { description: 'Tags for categorization' })),
  category: Type.Optional(
    Type.String({ description: 'Category (e.g., "planning", "learning", "decision")' }),
  ),
});

type Params = Static<typeof schema>;

export function saveConversationTool(deps: SaveConversationToolDeps): AgentTool<typeof schema> {
  return {
    name: 'save_conversation',
    label: 'Save Conversation',
    description:
      'Save a summary of the current conversation as a note. Only call this when the user explicitly asks to save the conversation or what was discussed. Compose a meaningful summary from the visible conversation context.',
    parameters: schema,
    execute: async (_toolCallId, params: Params) => {
      const now = new Date().toISOString();
      const id = uuidv4();

      const metadata: NoteMetadata = {
        id,
        type: 'conversation',
        title: params.title,
        created: now,
        updated: now,
        tags: params.tags ?? [],
        links: [],
        category: params.category ?? 'conversations',
        status: 'read',
        inputSource: 'text',
      };

      const filePath = deps.markdown.save(metadata, params.summary);
      deps.sqlite.upsertNote(metadata, params.summary, filePath);

      const embedText = `${params.title}\n\n${params.summary}`;
      try {
        const vector = await deps.generateEmbedding(embedText);
        await deps.vectorDb.upsert({
          id,
          text: embedText,
          vector,
          type: 'conversation',
          title: params.title,
        });
      } catch {
        // Embedding failure is non-fatal
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Conversation saved as "${params.title}" (id: ${id})${params.tags?.length ? `, tags: [${params.tags.join(', ')}]` : ''}.`,
          },
        ],
        details: { id, filePath, type: 'conversation' },
      };
    },
  };
}
