import { Type, StringEnum, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ContentType, ContentStatus } from '@echos/shared';
import type { SqliteStorage, ListNotesOptions } from '../../storage/sqlite.js';

export interface ListNotesToolDeps {
  sqlite: SqliteStorage;
}

const schema = Type.Object({
  type: Type.Optional(
    StringEnum(['note', 'journal', 'article', 'youtube', 'tweet', 'reminder', 'conversation'], {
      description: 'Filter by type',
    }),
  ),
  status: Type.Optional(
    StringEnum(['saved', 'read', 'archived'], {
      description: 'Filter by status',
    }),
  ),
  dateFrom: Type.Optional(
    Type.String({ description: 'Start date (ISO 8601)' }),
  ),
  dateTo: Type.Optional(
    Type.String({ description: 'End date (ISO 8601)' }),
  ),
  limit: Type.Optional(
    Type.Number({ description: 'Max notes (default 20)', default: 20, minimum: 1 }),
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
    description:
      'Browse notes by type or status. Use status="saved" for reading list, status="read" for consumed content. Always normalize user-provided dates to ISO 8601 (e.g. "22/12/2025" → "2025-12-22", "last August" → dateFrom="2025-08-01" dateTo="2025-08-31").',
    parameters: schema,
    execute: async (_toolCallId: string, params: Params) => {
      const opts: ListNotesOptions = {
        limit: params.limit ?? 20,
        offset: params.offset ?? 0,
      };
      if (params.type) opts.type = params.type as ContentType;
      if (params.status) opts.status = params.status as ContentStatus;
      if (params.dateFrom) opts.dateFrom = params.dateFrom;
      if (params.dateTo) opts.dateTo = params.dateTo;

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
        details: {
          count: rows.length,
          items: rows.map((r) => ({ id: r.id, title: r.title, type: r.type, status: r.status })),
        },
      };
    },
  };
}
