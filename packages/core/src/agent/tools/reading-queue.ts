import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ContentType } from '@echos/shared';
import type { SqliteStorage } from '../../storage/sqlite.js';

export interface ReadingQueueToolDeps {
  sqlite: SqliteStorage;
}

const schema = Type.Object({
  limit: Type.Optional(
    Type.Number({ description: 'Max items to return', default: 10 }),
  ),
  type: Type.Optional(
    Type.Union(
      [Type.Literal('article'), Type.Literal('youtube'), Type.Literal('tweet')],
      { description: 'Filter by content type' },
    ),
  ),
});

type Params = Static<typeof schema>;

export function createReadingQueueTool(deps: ReadingQueueToolDeps): AgentTool<typeof schema> {
  return {
    name: 'reading_queue',
    label: 'Reading Queue',
    description:
      'Lists unread saved items (articles, YouTube videos, tweets) sorted by recency. Use when the user asks "what should I read next?", "show my reading list", "what\'s in my queue", or wants content recommendations.',
    parameters: schema,
    execute: async (_toolCallId: string, params: Params) => {
      const limit = params.limit ?? 10;
      const type = params.type as ContentType | undefined;

      const opts = type
        ? { status: 'saved' as const, type, limit }
        : { status: 'saved' as const, limit };
      const items = deps.sqlite.listNotes(opts);

      if (items.length === 0) {
        const typeClause = type ? ` (type: ${type})` : '';
        return {
          content: [
            {
              type: 'text' as const,
              text: `No unread items in your reading queue${typeClause}.`,
            },
          ],
          details: { count: 0 },
        };
      }

      const lines: string[] = [`${items.length} unread item${items.length === 1 ? '' : 's'} in your reading queue:\n`];

      for (const item of items) {
        const tags = item.tags ? ` [${item.tags}]` : '';
        const source = item.sourceUrl ? ` — ${item.sourceUrl}` : '';
        const gist = item.gist ? `\n   ${item.gist}` : '';
        const date = item.created.slice(0, 10);
        lines.push(`• **${item.title}** (${item.type})${tags}\n  ID: ${item.id} | Saved: ${date}${source}${gist}`);
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        details: { count: items.length, items: items.map((i) => ({ id: i.id, title: i.title, type: i.type })) },
      };
    },
  };
}
