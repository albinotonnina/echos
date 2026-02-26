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
  dateFrom: Type.Optional(
    Type.String({ description: 'Return notes created on or after this date (ISO 8601, e.g. "2025-08-01" or "2025-08-19T00:00:00Z")' }),
  ),
  dateTo: Type.Optional(
    Type.String({ description: 'Return notes created on or before this date (ISO 8601, e.g. "2025-08-31" or "2025-08-19T23:59:59Z")' }),
  ),
  limit: Type.Optional(
    Type.Number({ description: 'Max notes to return. Default 20 for browsing; use a higher value (e.g. 500) when you need to scan the full collection.', default: 20, minimum: 1 }),
  ),
  offset: Type.Optional(
    Type.Number({ description: 'Pagination offset for retrieving notes beyond the initial batch', default: 0, minimum: 0 }),
  ),
});

type Params = Static<typeof schema>;

export function listNotesTool(deps: ListNotesToolDeps): AgentTool<typeof schema> {
  return {
    name: 'list_notes',
    label: 'List Notes',
    description:
      'Browse notes by type, category, or status. Use status="saved" to show the reading list, status="read" for consumed knowledge. Always normalize user-provided dates to ISO 8601 before filtering (e.g. "22/12/2025" → "2025-12-22", "last August" → dateFrom "2025-08-01" / dateTo "2025-08-31").',
    parameters: schema,
    execute: async (_toolCallId, params: Params) => {
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
        details: { count: rows.length },
      };
    },
  };
}
