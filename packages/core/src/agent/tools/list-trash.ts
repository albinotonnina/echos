import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { SqliteStorage } from '../../storage/sqlite.js';

export interface ListTrashToolDeps {
  sqlite: SqliteStorage;
}

const PURGE_AFTER_DAYS = 30;

const schema = Type.Object({});

type Params = Static<typeof schema>;

/** Tool to list all notes currently in the trash (soft-deleted). */
export function listTrashTool(deps: ListTrashToolDeps): AgentTool<typeof schema> {
  return {
    name: 'list_trash',
    label: 'List Trash',
    description:
      'List all notes in the trash. Shows title, original tags, deletion date, and days until permanent deletion. Notes are automatically purged after 30 days.',
    parameters: schema,
    execute: async (_toolCallId: string, _params: Params) => {
      const rows = deps.sqlite.listDeletedNotes();

      if (rows.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'Trash is empty.' }],
          details: { count: 0 },
        };
      }

      const now = Date.now();
      const lines = rows.map((row) => {
        const deletedAt = row.deletedAt ? new Date(row.deletedAt) : new Date();
        const daysSinceDelete = Math.floor((now - deletedAt.getTime()) / (1000 * 60 * 60 * 24));
        const daysUntilPurge = Math.max(0, PURGE_AFTER_DAYS - daysSinceDelete);
        const tags = row.tags ? row.tags.split(',').filter(Boolean) : [];
        const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
        return `- ${row.title}${tagStr} (id: ${row.id}, deleted: ${deletedAt.toISOString().slice(0, 10)}, ${daysUntilPurge} days until purge)`;
      });

      const text = `Trash (${rows.length} note${rows.length === 1 ? '' : 's'}):\n${lines.join('\n')}`;

      return {
        content: [{ type: 'text' as const, text }],
        details: { count: rows.length },
      };
    },
  };
}
