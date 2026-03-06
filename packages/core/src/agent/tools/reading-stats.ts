import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { SqliteStorage } from '../../storage/sqlite.js';

export interface ReadingStatsToolDeps {
  sqlite: SqliteStorage;
}

const schema = Type.Object({});

type Params = Static<typeof schema>;

const CONTENT_TYPES = ['article', 'youtube', 'tweet'] as const;

export function createReadingStatsTool(deps: ReadingStatsToolDeps): AgentTool<typeof schema> {
  return {
    name: 'reading_stats',
    label: 'Reading Stats',
    description:
      'Returns reading statistics: total saved/read/archived counts, breakdown by content type, recent activity (last 7 days), and read rate. Use when the user asks about reading habits, progress, or stats.',
    parameters: schema,
    execute: async (_toolCallId: string, _params: Params) => {
      const db = deps.sqlite.db;
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const typeBindings = { t0: CONTENT_TYPES[0], t1: CONTENT_TYPES[1], t2: CONTENT_TYPES[2] };

      const overallRow = db
        .prepare(
          `SELECT
            SUM(CASE WHEN status = 'saved'    THEN 1 ELSE 0 END) AS totalSaved,
            SUM(CASE WHEN status = 'read'     THEN 1 ELSE 0 END) AS totalRead,
            SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS totalArchived,
            SUM(CASE WHEN created >= @sevenDaysAgo               THEN 1 ELSE 0 END) AS recentSaves,
            SUM(CASE WHEN status = 'read' AND updated >= @sevenDaysAgo THEN 1 ELSE 0 END) AS recentReads
          FROM notes
          WHERE type IN (@t0, @t1, @t2)`,
        )
        .get({ sevenDaysAgo, ...typeBindings }) as {
          totalSaved: number | null;
          totalRead: number | null;
          totalArchived: number | null;
          recentSaves: number | null;
          recentReads: number | null;
        };

      const totalSaved = overallRow.totalSaved ?? 0;
      const totalRead = overallRow.totalRead ?? 0;
      const totalArchived = overallRow.totalArchived ?? 0;
      const recentSaves = overallRow.recentSaves ?? 0;
      const recentReads = overallRow.recentReads ?? 0;

      const byTypeRows = db
        .prepare(
          `SELECT
            type,
            SUM(CASE WHEN status = 'saved'    THEN 1 ELSE 0 END) AS saved,
            SUM(CASE WHEN status = 'read'     THEN 1 ELSE 0 END) AS read,
            SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived
          FROM notes
          WHERE type IN (@t0, @t1, @t2)
          GROUP BY type`,
        )
        .all(typeBindings) as { type: string; saved: number | null; read: number | null; archived: number | null }[];

      const byType: Record<string, { saved: number; read: number; archived: number }> = {};
      for (const t of CONTENT_TYPES) {
        const row = byTypeRows.find((r) => r.type === t);
        byType[t] = {
          saved: row?.saved ?? 0,
          read: row?.read ?? 0,
          archived: row?.archived ?? 0,
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
