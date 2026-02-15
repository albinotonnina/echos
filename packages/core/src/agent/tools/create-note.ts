import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { v4 as uuidv4 } from 'uuid';
import type { NoteMetadata, ContentType } from '@echos/shared';
import type { SqliteStorage } from '../../storage/sqlite.js';
import type { MarkdownStorage } from '../../storage/markdown.js';
import type { VectorStorage } from '../../storage/vectordb.js';

export interface CreateNoteToolDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
  vectorDb: VectorStorage;
  generateEmbedding: (text: string) => Promise<number[]>;
}

const schema = Type.Object({
  title: Type.String({ description: 'Note title', minLength: 1 }),
  content: Type.String({ description: 'Note content in markdown' }),
  type: Type.Optional(
    Type.Union([Type.Literal('note'), Type.Literal('journal')], {
      description: 'Note type',
      default: 'note',
    }),
  ),
  tags: Type.Optional(Type.Array(Type.String(), { description: 'Tags for categorization' })),
  category: Type.Optional(
    Type.String({ description: 'Category (e.g., "programming", "health")' }),
  ),
});

type Params = Static<typeof schema>;

export function createNoteTool(deps: CreateNoteToolDeps): AgentTool<typeof schema> {
  return {
    name: 'create_note',
    label: 'Create Note',
    description:
      'Create a new knowledge note with title, content, and optional tags/category. Use type "note" for general notes, "journal" for diary entries.',
    parameters: schema,
    execute: async (_toolCallId, params: Params) => {
      const now = new Date().toISOString();
      const id = uuidv4();
      const type: ContentType = params.type ?? 'note';

      const metadata: NoteMetadata = {
        id,
        type,
        title: params.title,
        created: now,
        updated: now,
        tags: params.tags ?? [],
        links: [],
        category: params.category ?? 'uncategorized',
      };

      const filePath = deps.markdown.save(metadata, params.content);
      deps.sqlite.upsertNote(metadata, params.content, filePath);

      const embedText = `${params.title}\n\n${params.content}`;
      try {
        const vector = await deps.generateEmbedding(embedText);
        await deps.vectorDb.upsert({ id, text: embedText, vector, type, title: params.title });
      } catch {
        // Embedding failure is non-fatal
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Created ${type} "${params.title}" (id: ${id}) with tags: [${(params.tags ?? []).join(', ')}], category: ${params.category ?? 'uncategorized'}.`,
          },
        ],
        details: { id, filePath, type },
      };
    },
  };
}
