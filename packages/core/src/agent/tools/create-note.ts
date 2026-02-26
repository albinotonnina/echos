import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { v4 as uuidv4 } from 'uuid';
import type { NoteMetadata, ContentType, InputSource } from '@echos/shared';
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
  inputSource: Type.Optional(
    Type.Union(
      [Type.Literal('text'), Type.Literal('voice'), Type.Literal('url'), Type.Literal('file')],
      { description: 'How the note was captured (text, voice, url, file)' },
    ),
  ),
});

type Params = Static<typeof schema>;

export function createNoteTool(deps: CreateNoteToolDeps): AgentTool<typeof schema> {
  return {
    name: 'create_note',
    label: 'Create Note',
    description:
      'Create a new note, journal entry, or any text the user wants to save. After creating, ALWAYS call categorize_note (mode="lightweight") to assign category and tags. Use type="journal" for diary entries. For voice transcriptions pass inputSource="voice". Journal categories should reflect the topic (e.g. "reflection", "work", "health").',
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
        status: 'read',
        inputSource: (params.inputSource as InputSource | undefined) ?? 'text',
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
