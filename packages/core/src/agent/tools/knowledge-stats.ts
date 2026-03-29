import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SqliteStorage } from '../../storage/sqlite.js';

export interface KnowledgeStatsToolDeps {
  sqlite: SqliteStorage;
  knowledgeDir: string;
  dbPath: string;
}

const schema = Type.Object({});

type Params = Static<typeof schema>;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function getDirSize(dirPath: string): Promise<number> {
  try {
    let total = 0;
    const entries = await readdir(dirPath, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const full = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          total += await getDirSize(full);
        } else if (entry.isFile()) {
          try {
            total += (await stat(full)).size;
          } catch {
            // skip unreadable files
          }
        }
      }),
    );
    return total;
  } catch {
    return 0;
  }
}

async function getFileSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

export function createKnowledgeStatsTool(deps: KnowledgeStatsToolDeps): AgentTool<typeof schema> {
  return {
    name: 'knowledge_stats',
    label: 'Knowledge Stats',
    description:
      'Returns a comprehensive overview of the knowledge base: note counts by type and status, weekly growth trends, top tags and categories, storage sizes, and activity streaks. Use when the user asks about their knowledge base stats, overview, or how their collection is growing.',
    parameters: schema,
    execute: async (_toolCallId: string, _params: Params) => {
      const { sqlite } = deps;

      // --- Totals by type ---
      const byType = sqlite.getContentTypeCounts();
      const totalNotes = Object.values(byType).reduce((a, b) => a + b, 0);

      // --- Total tags (distinct) ---
      const totalDistinctTags = sqlite.getDistinctTagCount();

      // --- Total links ---
      const totalLinks = sqlite.getLinkCount();

      // --- Status breakdown ---
      const statusCounts = sqlite.getStatusCounts();
      const statusSaved = statusCounts['saved'] ?? 0;
      const statusRead = statusCounts['read'] ?? 0;
      const statusArchived = statusCounts['archived'] ?? 0;
      const statusUnset = statusCounts['unset'] ?? 0;

      // --- Weekly growth (last 8 weeks) ---
      const weeklyGrowth = sqlite.getWeeklyCreationCounts(8);

      // Fill missing weeks with zeros for sparkline
      const weekMap = new Map<string, number>();
      for (const row of weeklyGrowth) {
        weekMap.set(row.week, row.count);
      }
      const allWeeks: { week: string; count: number }[] = [];
      for (let i = 7; i >= 0; i--) {
        const d = new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000);
        // Match SQLite strftime('%Y-W%W'): week 0 = days before first Monday,
        // week 1 starts on the first Monday of the year.
        const year = d.getFullYear();
        const startOfYear = new Date(year, 0, 1);
        const dayOfYear = Math.floor((d.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
        const firstMondayDoy = (8 - startOfYear.getDay()) % 7;
        const weekNum =
          dayOfYear < firstMondayDoy ? 0 : 1 + Math.floor((dayOfYear - firstMondayDoy) / 7);
        const week = `${year}-W${String(weekNum).padStart(2, '0')}`;
        allWeeks.push({ week, count: weekMap.get(week) ?? 0 });
      }

      // --- Streak calculation (consecutive weeks with activity, from most recent) ---
      const sorted = [...allWeeks].reverse();
      let currentStreak = 0;
      for (const row of sorted) {
        if (row.count > 0) currentStreak++;
        else break;
      }

      let longestStreak = 0;
      let runningStreak = 0;
      for (const row of allWeeks) {
        if (row.count > 0) {
          runningStreak++;
          if (runningStreak > longestStreak) longestStreak = runningStreak;
        } else {
          runningStreak = 0;
        }
      }

      // --- Top tags ---
      const topTags = sqlite.getTopTagsWithCounts(20);

      // --- Top categories ---
      const topCategories = sqlite.getCategoryFrequencies(10);

      // --- Storage sizes ---
      const [knowledgeDirSize, sqliteFileSize, vectorDirSize] = await Promise.all([
        getDirSize(deps.knowledgeDir),
        getFileSize(join(deps.dbPath, 'echos.db')),
        getDirSize(join(deps.dbPath, 'vectors')),
      ]);

      // --- Build output ---
      const ALL_TYPES = ['note', 'article', 'youtube', 'tweet', 'journal', 'image', 'conversation'] as const;

      const lines: string[] = [
        '## Knowledge Base Overview\n',
        `**Total notes:** ${totalNotes.toLocaleString()}`,
        `**Distinct tags:** ${totalDistinctTags.toLocaleString()}`,
        `**Total links:** ${totalLinks.toLocaleString()}`,
        '',
        '### By Type',
      ];

      for (const t of ALL_TYPES) {
        const c = byType[t] ?? 0;
        if (c > 0 || t === 'note') {
          lines.push(`- ${t}: ${c.toLocaleString()}`);
        }
      }

      const otherTypes = Object.keys(byType).filter(
        (t) => !(ALL_TYPES as readonly string[]).includes(t) && (byType[t] ?? 0) > 0,
      );
      for (const t of otherTypes) {
        lines.push(`- ${t}: ${(byType[t] ?? 0).toLocaleString()}`);
      }

      lines.push(
        '',
        '### By Status',
        `- Saved (unread): ${statusSaved.toLocaleString()}`,
        `- Read: ${statusRead.toLocaleString()}`,
        `- Archived: ${statusArchived.toLocaleString()}`,
        `- No status: ${statusUnset.toLocaleString()}`,
        '',
        '### Weekly Growth (last 8 weeks)',
      );

      const sparkChars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
      const maxCount = Math.max(...allWeeks.map((w) => w.count), 1);
      const sparkline = allWeeks
        .map((w) => sparkChars[Math.min(Math.floor((w.count / maxCount) * (sparkChars.length - 1)), sparkChars.length - 1)] ?? '▁')
        .join('');
      lines.push(`${sparkline}  (oldest → newest)`);
      for (const w of allWeeks) {
        lines.push(`- ${w.week}: ${w.count}`);
      }

      lines.push(
        '',
        '### Activity Streaks (weeks)',
        `- Current streak: ${currentStreak} week${currentStreak !== 1 ? 's' : ''}`,
        `- Longest streak: ${longestStreak} week${longestStreak !== 1 ? 's' : ''}`,
      );

      if (topTags.length > 0) {
        lines.push('', '### Top 20 Tags');
        for (const t of topTags) {
          lines.push(`- ${t.tag}: ${t.count}`);
        }
      }

      if (topCategories.length > 0) {
        lines.push('', '### Top 10 Categories');
        for (const c of topCategories) {
          lines.push(`- ${c.category}: ${c.count}`);
        }
      }

      lines.push(
        '',
        '### Storage',
        `- Knowledge files: ${formatBytes(knowledgeDirSize)}`,
        `- SQLite database: ${formatBytes(sqliteFileSize)}`,
        `- Vector database: ${formatBytes(vectorDirSize)}`,
        `- Total: ${formatBytes(knowledgeDirSize + sqliteFileSize + vectorDirSize)}`,
      );

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        details: {
          totalNotes,
          totalDistinctTags,
          totalLinks,
          byType,
          statusSaved,
          statusRead,
          statusArchived,
          statusUnset,
          weeklyGrowth: allWeeks,
          streaks: { currentStreak, longestStreak },
          topTags,
          topCategories,
          storage: {
            knowledgeDirBytes: knowledgeDirSize,
            sqliteBytes: sqliteFileSize,
            vectorDbBytes: vectorDirSize,
          },
        },
      };
    },
  };
}
