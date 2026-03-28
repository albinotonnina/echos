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
  permanent: Type.Optional(
    Type.Boolean({
      description:
        'If true, permanently delete the note (skip trash). Default is false — note is moved to trash and can be restored.',
    }),
  ),
});

type Params = Static<typeof schema>;

export function deleteNoteTool(deps: DeleteNoteToolDeps): AgentTool<typeof schema> {
  return {
    name: 'delete_note',
    label: 'Delete Note',
    description:
      'Delete a note by ID. By default, moves the note to trash (recoverable for 30 days). Set permanent=true to permanently delete. Always confirm with the user before deleting.',
    parameters: schema,
    execute: async (_toolCallId: string, params: Params) => {
      const row = deps.sqlite.getNote(params.id);
      if (!row) {
        throw new Error(`Note not found: ${params.id}`);
      }

      if (params.permanent) {
        // Hard delete: remove from all stores
        deps.markdown.remove(row.filePath);
        deps.sqlite.purgeNote(params.id);
        await deps.vectorDb.remove(params.id);

        return {
          content: [
            {
              type: 'text' as const,
              text: `Permanently deleted note "${row.title}" (${params.id}).`,
            },
          ],
          details: { id: params.id, title: row.title, permanent: true },
        };
      }

      // Soft delete: move to trash, update file_path in SQLite
      const trashPath = deps.markdown.moveToTrash(row.filePath);
      deps.sqlite.deleteNote(params.id, trashPath);
      // Keep vectors — they're cheap and will be removed on purge

      return {
        content: [
          {
            type: 'text' as const,
            text: `Moved note "${row.title}" (${params.id}) to trash. It will be permanently deleted after 30 days. Use restore_note to recover it.`,
          },
        ],
        details: { id: params.id, title: row.title, permanent: false },
      };
    },
  };
}
