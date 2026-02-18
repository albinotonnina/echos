import { Type, StringEnum, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ContentStatus } from '@echos/shared';
import type { SqliteStorage } from '../../storage/sqlite.js';
import type { MarkdownStorage } from '../../storage/markdown.js';

export interface MarkContentToolDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
}

const schema = Type.Object({
  id: Type.String({ description: 'ID of the note to update' }),
  status: StringEnum(['saved', 'read', 'archived'], {
    description:
      'New status: "read" when user has engaged with content, "archived" to hide from normal search, "saved" to reset to unread.',
  }),
});

type Params = Static<typeof schema>;

export function markContentTool(deps: MarkContentToolDeps): AgentTool<typeof schema> {
  return {
    name: 'mark_content',
    label: 'Mark Content',
    description:
      'Update the status of a note or saved content. Use this when: (1) user says they\'ve read an article, (2) user asks to archive content, (3) user starts actively discussing a saved article (auto-mark as read). Status options: "saved" (unread), "read" (consumed), "archived" (hidden from search).',
    parameters: schema,
    execute: async (_toolCallId, params: Params) => {
      const existing = deps.sqlite.getNote(params.id);
      if (!existing) {
        return {
          content: [{ type: 'text' as const, text: `Note with id "${params.id}" not found.` }],
          details: { success: false },
        };
      }

      const status = params.status as ContentStatus;
      deps.sqlite.updateNoteStatus(params.id, status);

      // Update the markdown file frontmatter if it exists
      const filePath = existing.filePath;
      try {
        deps.markdown.update(filePath, { status });
      } catch {
        // Non-fatal — SQLite is the source of truth for status queries
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Marked "${existing.title}" as ${status}.`,
          },
        ],
        details: { id: params.id, status, title: existing.title },
      };
    },
  };
}
