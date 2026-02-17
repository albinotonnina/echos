import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { NoteMetadata } from '@echos/shared';
import type { SqliteStorage } from '../../storage/sqlite.js';
import type { MarkdownStorage } from '../../storage/markdown.js';
import type { VectorStorage } from '../../storage/vectordb.js';

export interface UpdateNoteToolDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
  vectorDb: VectorStorage;
  generateEmbedding: (text: string) => Promise<number[]>;
}

const schema = Type.Object({
  id: Type.String({ description: 'Note ID to update' }),
  title: Type.Optional(Type.String({ description: 'New title' })),
  content: Type.Optional(Type.String({ description: 'New content (replaces existing)' })),
  tags: Type.Optional(Type.Array(Type.String(), { description: 'New tags (replaces existing)' })),
  category: Type.Optional(Type.String({ description: 'New category' })),
});

type Params = Static<typeof schema>;

export function updateNoteTool(deps: UpdateNoteToolDeps): AgentTool<typeof schema> {
  return {
    name: 'update_note',
    label: 'Update Note',
    description: 'Update an existing note. Can modify title, content, tags, or category.',
    parameters: schema,
    execute: async (_toolCallId, params: Params) => {
      const row = deps.sqlite.getNote(params.id);
      if (!row) {
        throw new Error(`Note not found: ${params.id}`);
      }

      const partialMeta: Partial<NoteMetadata> = {};
      if (params.title) partialMeta.title = params.title;
      if (params.tags) partialMeta.tags = params.tags;
      if (params.category) partialMeta.category = params.category;

      let updated: { metadata: NoteMetadata; content: string; filePath: string };

      if (deps.markdown.read(row.filePath)) {
        updated = deps.markdown.update(row.filePath, partialMeta, params.content);
      } else {
        // File missing — reconstruct from SQLite then apply updates
        const baseMetadata: NoteMetadata = {
          id: row.id,
          type: row.type,
          title: row.title,
          created: row.created,
          updated: new Date().toISOString(),
          tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
          links: row.links ? row.links.split(',').filter(Boolean) : [],
          category: row.category,
        };
        if (row.sourceUrl != null) baseMetadata.sourceUrl = row.sourceUrl;
        if (row.author != null) baseMetadata.author = row.author;
        if (row.gist != null) baseMetadata.gist = row.gist;
        const metadata: NoteMetadata = { ...baseMetadata, ...partialMeta, updated: new Date().toISOString() };
        const content = params.content ?? row.content;
        const filePath = deps.markdown.save(metadata, content);
        updated = { metadata, content, filePath };
      }

      deps.sqlite.upsertNote(updated.metadata, updated.content, updated.filePath);

      const embedText = `${updated.metadata.title}\n\n${updated.content}`;
      try {
        const vector = await deps.generateEmbedding(embedText);
        await deps.vectorDb.upsert({
          id: params.id,
          text: embedText,
          vector,
          type: updated.metadata.type,
          title: updated.metadata.title,
        });
      } catch {
        // Non-fatal
      }

      const changes = [
        params.title ? `title → "${params.title}"` : '',
        params.content ? 'content updated' : '',
        params.tags ? `tags → [${params.tags.join(', ')}]` : '',
        params.category ? `category → "${params.category}"` : '',
      ]
        .filter(Boolean)
        .join(', ');

      return {
        content: [
          {
            type: 'text' as const,
            text: `Updated note "${updated.metadata.title}" (${params.id}): ${changes}`,
          },
        ],
        details: { id: params.id },
      };
    },
  };
}
