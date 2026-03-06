import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ContentType } from '@echos/shared';
import type { SqliteStorage, NoteRow } from '../../storage/sqlite.js';

export interface ReadingQueueToolDeps {
  sqlite: SqliteStorage;
}

const schema = Type.Object({
  limit: Type.Optional(
    Type.Number({ description: 'Max items to return', default: 10, minimum: 1 }),
  ),
  type: Type.Optional(
    Type.Union(
      [Type.Literal('article'), Type.Literal('youtube'), Type.Literal('tweet')],
      { description: 'Filter by content type' },
    ),
  ),
});

type Params = Static<typeof schema>;

interface RecentRead {
  tags: string;
  category: string;
}

function scoreItem(
  item: NoteRow,
  interestTags: Set<string>,
  interestCategories: Set<string>,
): number {
  const daysSinceSaved = (Date.now() - new Date(item.created).getTime()) / (1000 * 60 * 60 * 24);
  const recencyScore = 1 / (daysSinceSaved + 1);

  const itemTags = item.tags ? item.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
  let tagOverlapScore = 0;
  for (const tag of itemTags) {
    if (interestTags.has(tag)) tagOverlapScore++;
  }

  const categoryMatchScore = interestCategories.has(item.category) ? 1 : 0;

  return tagOverlapScore * 2 + categoryMatchScore * 1 + recencyScore * 0.5;
}

export function createReadingQueueTool(deps: ReadingQueueToolDeps): AgentTool<typeof schema> {
  return {
    name: 'reading_queue',
    label: 'Reading Queue',
    description:
      'Lists unread saved items (articles, YouTube videos, tweets) sorted by relevance to recent reading interests. Use when the user asks "what should I read next?", "show my reading list", "what\'s in my queue", or wants content recommendations.',
    parameters: schema,
    execute: async (_toolCallId: string, params: Params) => {
      const limit = params.limit ?? 10;
      const type = params.type as ContentType | undefined;

      // Fetch all unread items (cap 200 for scoring)
      const opts = type
        ? { status: 'saved' as const, type, limit: 200 }
        : { status: 'saved' as const, limit: 200 };
      const allItems = deps.sqlite.listNotes(opts);

      if (allItems.length === 0) {
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

      // Fetch recent reads for interest profile (last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const recentReads = deps.sqlite.db
        .prepare(
          `SELECT tags, category FROM notes
           WHERE status = 'read'
             AND type IN ('article', 'youtube', 'tweet')
             AND updated >= ?
           ORDER BY updated DESC
           LIMIT 20`,
        )
        .all(thirtyDaysAgo) as RecentRead[];

      // Build interest profile
      const interestTags = new Set<string>();
      const interestCategories = new Set<string>();
      for (const read of recentReads) {
        if (read.tags) {
          for (const tag of read.tags.split(',').map((t) => t.trim()).filter(Boolean)) {
            interestTags.add(tag);
          }
        }
        if (read.category) {
          interestCategories.add(read.category);
        }
      }

      // Score, sort, slice
      const items = allItems
        .map((item) => ({ item, score: scoreItem(item, interestTags, interestCategories) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((s) => s.item);

      const relevanceNote =
        recentReads.length >= 3 ? 'Sorted by relevance to your recent reading interests.\n\n' : '';

      const lines: string[] = [
        `${relevanceNote}${items.length} unread item${items.length === 1 ? '' : 's'} in your reading queue:\n`,
      ];

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
