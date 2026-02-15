import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { SqliteStorage } from '../../storage/sqlite.js';
import type { MarkdownStorage } from '../../storage/markdown.js';
import type { VectorStorage } from '../../storage/vectordb.js';

export interface DeleteNoteToolDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
  vectorDb: VectorStorage;
}

const schema = Type.Object({
  id: Type.String({ description: 'Note ID to delete' }),
});

type Params = Static<typeof schema>;

export function deleteNoteTool(deps: DeleteNoteToolDeps): AgentTool<typeof schema> {
  return {
    name: 'delete_note',
    label: 'Delete Note',
    description:
      'Permanently delete a note by its ID. The note is removed from storage, index, and vector database.',
    parameters: schema,
    execute: async (_toolCallId, params: Params) => {
      const row = deps.sqlite.getNote(params.id);
      if (!row) {
        throw new Error(`Note not found: ${params.id}`);
      }

      deps.markdown.remove(row.filePath);
      deps.sqlite.deleteNote(params.id);
      await deps.vectorDb.remove(params.id);

      return {
        content: [{ type: 'text' as const, text: `Deleted note "${row.title}" (${params.id}).` }],
        details: { id: params.id, title: row.title },
      };
    },
  };
}
