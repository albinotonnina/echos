import { Type, StringEnum, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ContentType, ContentStatus } from '@echos/shared';
import type { SqliteStorage, ListNotesOptions } from '../../storage/sqlite.js';

export interface ListNotesToolDeps {
  sqlite: SqliteStorage;
}

const schema = Type.Object({
  type: Type.Optional(
    StringEnum(['note', 'journal', 'article', 'youtube', 'reminder', 'conversation'], {
      description: 'Filter by content type',
    }),
  ),
  status: Type.Optional(
    StringEnum(['saved', 'read', 'archived'], {
      description: 'Filter by content status. Use "saved" for reading list, "read" for consumed content, "archived" to include archived items.',
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: 'Max notes to return', default: 20, minimum: 1, maximum: 100 }),
  ),
  offset: Type.Optional(
    Type.Number({ description: 'Pagination offset', default: 0, minimum: 0 }),
  ),
});

type Params = Static<typeof schema>;

export function listNotesTool(deps: ListNotesToolDeps): AgentTool<typeof schema> {
  return {
    name: 'list_notes',
    label: 'List Notes',
    description: 'List notes with optional filtering by type. Returns titles, types, and dates.',
    parameters: schema,
    execute: async (_toolCallId, params: Params) => {
      const opts: ListNotesOptions = {
        limit: params.limit ?? 20,
        offset: params.offset ?? 0,
      };
      if (params.type) opts.type = params.type as ContentType;
      if (params.status) opts.status = params.status as ContentStatus;

      const rows = deps.sqlite.listNotes(opts);

      if (rows.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No notes found.' }],
          details: { count: 0 },
        };
      }

      const formatted = rows
        .map((row, i) => {
          const statusLabel = row.status ? ` | Status: ${row.status}` : '';
          return `${i + 1 + (params.offset ?? 0)}. **${row.title}** (${row.type}, id: ${row.id})\n   Created: ${row.created} | Tags: [${row.tags}]${statusLabel}`;
        })
        .join('\n');

      return {
        content: [{ type: 'text' as const, text: `Showing ${rows.length} note(s):\n\n${formatted}` }],
        details: { count: rows.length },
      };
    },
  };
}
