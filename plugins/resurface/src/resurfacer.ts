import type { SqliteStorage } from '@echos/core';

export interface SurfacedNote {
  id: string;
  title: string;
  type: string;
  category: string;
  tags: string[];
  gist: string | null;
  created: string;
  sourceUrl: string | null;
  reason: 'forgotten' | 'on_this_day' | 'random';
}

/**
 * Picks notes to resurface using three strategies:
 * - forgotten: notes not surfaced in a while (or never), oldest first
 * - on_this_day: notes created on the same calendar date in a prior year
 * - random: random sampling of un-recently-surfaced notes
 * - mix: blend of forgotten + on_this_day
 *
 * Updates `last_surfaced` for every returned note.
 */
export function resurfaceNotes(
  sqlite: SqliteStorage,
  opts: { limit?: number; mode?: 'forgotten' | 'on_this_day' | 'random' | 'mix' } = {},
): SurfacedNote[] {
  const db = sqlite.db;
  const limit = opts.limit ?? 3;
  const mode = opts.mode ?? 'mix';

  const threshold = new Date();
  threshold.setDate(threshold.getDate() - 7);
  const thresholdIso = threshold.toISOString();

  let rows: SurfacedNote[] = [];

  if (mode === 'forgotten' || mode === 'mix') {
    const forgottenRows = db
      .prepare(
        `SELECT id, type, title, category, tags, gist, created, source_url AS sourceUrl
         FROM notes
         WHERE (status != 'archived' OR status IS NULL)
           AND (last_surfaced IS NULL OR last_surfaced < ?)
         ORDER BY last_surfaced ASC NULLS FIRST, created ASC
         LIMIT ?`,
      )
      .all(thresholdIso, mode === 'mix' ? Math.ceil(limit * 0.6) : limit) as Array<{
      id: string;
      type: string;
      title: string;
      category: string;
      tags: string;
      gist: string | null;
      created: string;
      sourceUrl: string | null;
    }>;

    rows.push(
      ...forgottenRows.map((r) => ({
        ...r,
        tags: r.tags ? r.tags.split(',').filter(Boolean) : [],
        reason: 'forgotten' as const,
      })),
    );
  }

  if (mode === 'on_this_day' || mode === 'mix') {
    const now = new Date();
    // Match notes from same month-day in any prior year
    const monthDay = `%-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}%`;

    const onThisDayRows = db
      .prepare(
        `SELECT id, type, title, category, tags, gist, created, source_url AS sourceUrl
         FROM notes
         WHERE created LIKE ?
           AND strftime('%Y', created) < strftime('%Y', 'now')
           AND (status != 'archived' OR status IS NULL)
           AND (last_surfaced IS NULL OR last_surfaced < ?)
         ORDER BY RANDOM()
         LIMIT ?`,
      )
      .all(monthDay, thresholdIso, mode === 'mix' ? Math.ceil(limit * 0.4) : limit) as Array<{
      id: string;
      type: string;
      title: string;
      category: string;
      tags: string;
      gist: string | null;
      created: string;
      sourceUrl: string | null;
    }>;

    // Deduplicate against already-selected forgotten rows
    const existingIds = new Set(rows.map((r) => r.id));
    rows.push(
      ...onThisDayRows
        .filter((r) => !existingIds.has(r.id))
        .map((r) => ({
          ...r,
          tags: r.tags ? r.tags.split(',').filter(Boolean) : [],
          reason: 'on_this_day' as const,
        })),
    );
  }

  if (mode === 'random') {
    const randomRows = db
      .prepare(
        `SELECT id, type, title, category, tags, gist, created, source_url AS sourceUrl
         FROM notes
         WHERE (last_surfaced IS NULL OR last_surfaced < ?)
           AND (status != 'archived' OR status IS NULL)
         ORDER BY RANDOM()
         LIMIT ?`,
      )
      .all(thresholdIso, limit) as Array<{
      id: string;
      type: string;
      title: string;
      category: string;
      tags: string;
      gist: string | null;
      created: string;
      sourceUrl: string | null;
    }>;

    rows = randomRows.map((r) => ({
      ...r,
      tags: r.tags ? r.tags.split(',').filter(Boolean) : [],
      reason: 'random' as const,
    }));
  }

  // Trim to requested limit
  rows = rows.slice(0, limit);

  // Update last_surfaced for selected notes
  if (rows.length > 0) {
    const now = new Date().toISOString();
    const updateStmt = db.prepare(`UPDATE notes SET last_surfaced = ? WHERE id = ?`);
    for (const row of rows) {
      updateStmt.run(now, row.id);
    }
  }

  return rows;
}

export function formatSurfacedNote(note: SurfacedNote): string {
  const reasonLabel: Record<SurfacedNote['reason'], string> = {
    forgotten: '🔮 Resurfaced',
    on_this_day: '📅 On this day',
    random: '🎲 Discovery',
  };

  const year = new Date(note.created).getFullYear();
  const dateLabel = note.reason === 'on_this_day' ? ` (${year})` : '';
  const tagsStr = note.tags.length > 0 ? ` · ${note.tags.map((t) => `#${t}`).join(' ')}` : '';
  const gist = note.gist ? `\n> ${note.gist}` : '';

  return `${reasonLabel[note.reason]}${dateLabel}: **${note.title}**${tagsStr}${gist}`;
}
