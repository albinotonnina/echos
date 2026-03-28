import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { RevisionStorage } from '../../storage/revisions.js';
import type { SqliteStorage } from '../../storage/sqlite.js';

export interface NoteHistoryToolDeps {
  sqlite: SqliteStorage;
  revisions: RevisionStorage;
}

const schema = Type.Object({
  noteId: Type.String({ description: 'Note ID to view history for' }),
  limit: Type.Optional(
    Type.Number({ description: 'Max revisions to return (default 10)', minimum: 1, maximum: 50 }),
  ),
});

type Params = Static<typeof schema>;

export function noteHistoryTool(deps: NoteHistoryToolDeps): AgentTool<typeof schema> {
  return {
    name: 'note_history',
    label: 'Note History',
    description:
      'View the revision history of a note. Shows past versions with timestamps, titles, and a brief summary of what changed.',
    parameters: schema,
    execute: async (_toolCallId: string, params: Params) => {
      const note = deps.sqlite.getNote(params.noteId);
      if (!note) {
        throw new Error(`Note not found: ${params.noteId}`);
      }

      const revisions = deps.revisions.getRevisions(params.noteId, params.limit ?? 10);

      if (revisions.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No revision history for "${note.title}" (${params.noteId}). History is created when a note is updated.`,
            },
          ],
          details: { noteId: params.noteId, count: 0 },
        };
      }

      const lines = [
        `## Revision History for "${note.title}"`,
        `**Current version:** updated ${note.updated}`,
        `**${revisions.length} revision(s) found:**`,
        '',
      ];

      for (const rev of revisions) {
        const tagList = rev.tags ? rev.tags.split(',').filter(Boolean) : [];
        const changes: string[] = [];
        if (rev.title !== note.title) changes.push(`title was "${rev.title}"`);
        if (rev.category !== note.category) changes.push(`category was "${rev.category}"`);
        if (tagList.join(',') !== note.tags) changes.push('tags differed');
        if (rev.content !== note.content) changes.push('content differed');

        const summary = changes.length > 0 ? changes.join(', ') : 'snapshot (no diff from current)';

        lines.push(`- **${rev.createdAt}** — \`${rev.id}\``);
        lines.push(`  Title: "${rev.title}" | ${summary}`);
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        details: { noteId: params.noteId, count: revisions.length },
      };
    },
  };
}
