import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { NoteMetadata } from '@echos/shared';
import type { RevisionStorage } from '../../storage/revisions.js';
import type { SqliteStorage } from '../../storage/sqlite.js';
import type { MarkdownStorage } from '../../storage/markdown.js';
import type { VectorStorage } from '../../storage/vectordb.js';

export interface RestoreVersionToolDeps {
  sqlite: SqliteStorage;
  revisions: RevisionStorage;
  markdown: MarkdownStorage;
  vectorDb: VectorStorage;
  generateEmbedding: (text: string) => Promise<number[]>;
}

const schema = Type.Object({
  noteId: Type.String({ description: 'Note ID to restore' }),
  revisionId: Type.String({ description: 'Revision ID to restore from' }),
});

type Params = Static<typeof schema>;

export function restoreVersionTool(deps: RestoreVersionToolDeps): AgentTool<typeof schema> {
  return {
    name: 'restore_version',
    label: 'Restore Version',
    description:
      'Restore a note to a previous version. Saves the current state as a new revision first, then overwrites the note with the target revision content.',
    parameters: schema,
    execute: async (_toolCallId: string, params: Params) => {
      const note = deps.sqlite.getNote(params.noteId);
      if (!note) {
        throw new Error(`Note not found: ${params.noteId}`);
      }

      const revision = deps.revisions.getRevision(params.revisionId);
      if (!revision) {
        throw new Error(`Revision not found: ${params.revisionId}`);
      }
      if (revision.noteId !== params.noteId) {
        throw new Error(`Revision ${params.revisionId} does not belong to note ${params.noteId}`);
      }

      // Save current state as a revision before restoring
      deps.revisions.saveRevision(
        note.id,
        note.title,
        note.content,
        note.tags,
        note.category,
      );

      // Restore from revision
      const restoredTags = revision.tags ? revision.tags.split(',').filter(Boolean) : [];
      const partialMeta: Partial<NoteMetadata> = {
        title: revision.title,
        tags: restoredTags,
        category: revision.category,
      };

      let updated: { metadata: NoteMetadata; content: string; filePath: string };

      if (deps.markdown.read(note.filePath)) {
        updated = deps.markdown.update(note.filePath, partialMeta, revision.content);
      } else {
        const metadata: NoteMetadata = {
          id: note.id,
          type: note.type,
          title: revision.title,
          created: note.created,
          updated: new Date().toISOString(),
          tags: restoredTags,
          links: note.links ? note.links.split(',').filter(Boolean) : [],
          category: revision.category,
        };
        if (note.sourceUrl != null) metadata.sourceUrl = note.sourceUrl;
        if (note.author != null) metadata.author = note.author;
        if (note.gist != null) metadata.gist = note.gist;
        const filePath = deps.markdown.save(metadata, revision.content);
        updated = { metadata, content: revision.content, filePath };
      }

      deps.sqlite.upsertNote(updated.metadata, updated.content, updated.filePath);

      // Update vector embedding
      const embedText = `${updated.metadata.title}\n\n${updated.content}`;
      try {
        const vector = await deps.generateEmbedding(embedText);
        await deps.vectorDb.upsert({
          id: params.noteId,
          text: embedText,
          vector,
          type: updated.metadata.type,
          title: updated.metadata.title,
        });
      } catch {
        // Non-fatal
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Restored note "${updated.metadata.title}" (${params.noteId}) to revision from ${revision.createdAt}. Previous state saved as a new revision.`,
          },
        ],
        details: { noteId: params.noteId, revisionId: params.revisionId },
      };
    },
  };
}
