import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { SqliteStorage } from '../../storage/sqlite.js';
import type { MarkdownStorage } from '../../storage/markdown.js';

export interface RestoreNoteToolDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
}

const schema = Type.Object({
  noteId: Type.String({ description: 'ID of the trashed note to restore' }),
});

type Params = Static<typeof schema>;

/** Tool to restore a soft-deleted note from trash back to active state. */
export function restoreNoteTool(deps: RestoreNoteToolDeps): AgentTool<typeof schema> {
  return {
    name: 'restore_note',
    label: 'Restore Note',
    description:
      'Restore a note from the trash. Only works for notes that have been soft-deleted (status=deleted). The note will be restored to its original location.',
    parameters: schema,
    execute: async (_toolCallId: string, params: Params) => {
      const row = deps.sqlite.getNote(params.noteId);
      if (!row) {
        throw new Error(`Note not found: ${params.noteId}`);
      }

      if (row.status !== 'deleted') {
        throw new Error(`Note "${row.title}" is not in the trash (status=${row.status ?? 'none'})`);
      }

      // file_path in SQLite now points to the .trash/ location (updated during soft-delete).
      // Derive the original path by removing the /.trash/ segment.
      const trashFilePath = row.filePath;
      if (!trashFilePath.includes('/.trash/')) {
        throw new Error(
          `Note "${row.title}" has status=deleted but file_path does not contain /.trash/: ${trashFilePath}`,
        );
      }
      const originalFilePath = trashFilePath.replace('/.trash/', '/');

      deps.markdown.restoreFromTrash(trashFilePath, originalFilePath);
      deps.sqlite.restoreNote(params.noteId, originalFilePath);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Restored note "${row.title}" (${params.noteId}) from trash.`,
          },
        ],
        details: { id: params.noteId, title: row.title },
      };
    },
  };
}
