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

      // The file is currently in .trash/ — compute the original path.
      // The trash path preserves the relative structure, so we reverse it.
      const trashFilePath = row.filePath;
      // .trash/ is inserted after baseDir: knowledge/.trash/type/category/file.md
      // Original path: knowledge/type/category/file.md
      const originalFilePath = trashFilePath.replace('/.trash/', '/');

      deps.markdown.restoreFromTrash(trashFilePath, originalFilePath);
      deps.sqlite.restoreNote(params.noteId);

      // Update the file_path in SQLite to point to the restored location
      const restoredRow = deps.sqlite.getNote(params.noteId);
      if (restoredRow) {
        // Re-upsert to update the file_path column
        const tags = restoredRow.tags ? restoredRow.tags.split(',').filter(Boolean) : [];
        const links = restoredRow.links ? restoredRow.links.split(',').filter(Boolean) : [];
        deps.sqlite.upsertNote(
          {
            id: restoredRow.id,
            type: restoredRow.type,
            title: restoredRow.title,
            created: restoredRow.created,
            updated: restoredRow.updated,
            tags,
            links,
            category: restoredRow.category,
            ...(restoredRow.sourceUrl !== null ? { sourceUrl: restoredRow.sourceUrl } : {}),
            ...(restoredRow.author !== null ? { author: restoredRow.author } : {}),
            ...(restoredRow.gist !== null ? { gist: restoredRow.gist } : {}),
            status: 'saved',
            ...(restoredRow.inputSource !== null
              ? { inputSource: restoredRow.inputSource as 'text' | 'voice' | 'url' | 'file' | 'image' }
              : {}),
            ...(restoredRow.imagePath !== null ? { imagePath: restoredRow.imagePath } : {}),
            ...(restoredRow.imageUrl !== null ? { imageUrl: restoredRow.imageUrl } : {}),
            ...(restoredRow.imageMetadata !== null ? { imageMetadata: restoredRow.imageMetadata } : {}),
            ...(restoredRow.ocrText !== null ? { ocrText: restoredRow.ocrText } : {}),
          },
          restoredRow.content,
          originalFilePath,
          restoredRow.contentHash ?? undefined,
        );
      }

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
