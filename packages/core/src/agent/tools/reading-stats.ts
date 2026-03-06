import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { SqliteStorage } from '../../storage/sqlite.js';

export interface ReadingStatsToolDeps {
  sqlite: SqliteStorage;
}

const schema = Type.Object({});

type Params = Static<typeof schema>;

const CONTENT_TYPES = ['article', 'youtube', 'tweet'] as const;
const TYPE_IN = `('article','youtube','tweet')`;

export function createReadingStatsTool(deps: ReadingStatsToolDeps): AgentTool<typeof schema> {
  return {
    name: 'reading_stats',
    label: 'Reading Stats',
    description:
      'Returns reading statistics: total saved/read/archived counts, breakdown by content type, recent activity (last 7 days), and read rate. Use when the user asks about reading habits, progress, or stats.',
    parameters: schema,
    execute: async (_toolCallId: string, _params: Params) => {
      const db = deps.sqlite.db;

      const count = (sql: string) => {
        const row = db.prepare(sql).get() as { n: number };
        return row.n;
      };

      const totalSaved = count(`SELECT COUNT(*) AS n FROM notes WHERE type IN ${TYPE_IN} AND status = 'saved'`);
      const totalRead = count(`SELECT COUNT(*) AS n FROM notes WHERE type IN ${TYPE_IN} AND status = 'read'`);
      const totalArchived = count(`SELECT COUNT(*) AS n FROM notes WHERE type IN ${TYPE_IN} AND status = 'archived'`);

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const recentSaves = count(
        `SELECT COUNT(*) AS n FROM notes WHERE type IN ${TYPE_IN} AND status = 'saved' AND created >= '${sevenDaysAgo}'`,
      );
      const recentReads = count(
        `SELECT COUNT(*) AS n FROM notes WHERE type IN ${TYPE_IN} AND status = 'read' AND updated >= '${sevenDaysAgo}'`,
      );

      const byType: Record<string, { saved: number; read: number; archived: number }> = {};
      for (const t of CONTENT_TYPES) {
        byType[t] = {
          saved: count(`SELECT COUNT(*) AS n FROM notes WHERE type = '${t}' AND status = 'saved'`),
          read: count(`SELECT COUNT(*) AS n FROM notes WHERE type = '${t}' AND status = 'read'`),
          archived: count(`SELECT COUNT(*) AS n FROM notes WHERE type = '${t}' AND status = 'archived'`),
        };
      }

      const total = totalSaved + totalRead + totalArchived;
      const readRate = total > 0 ? Math.round((totalRead / total) * 100) : 0;

      const lines: string[] = [
        '## Reading Stats\n',
        `**Overall:** ${total} saveable items total`,
        `- Unread (saved): ${totalSaved}`,
        `- Read: ${totalRead}`,
        `- Archived: ${totalArchived}`,
        `- Read rate: ${readRate}%`,
        '',
        '**Last 7 days:**',
        `- New saves: ${recentSaves}`,
        `- Items read: ${recentReads}`,
        '',
        '**By type:**',
      ];

      for (const t of CONTENT_TYPES) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const s = byType[t]!;
        lines.push(`- ${t}: ${s.saved} unread / ${s.read} read / ${s.archived} archived`);
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        details: {
          totalSaved,
          totalRead,
          totalArchived,
          readRate,
          recentSaves,
          recentReads,
          byType,
        },
      };
    },
  };
}
