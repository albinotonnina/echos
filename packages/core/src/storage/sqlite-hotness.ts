import type Database from 'better-sqlite3';

export interface HotnessRow {
  noteId: string;
  retrievalCount: number;
  lastAccessed: string;
}

export interface HotnessOps {
  recordAccess(noteId: string): void;
  getHotness(noteIds: string[]): Map<string, { retrievalCount: number; lastAccessed: string }>;
  getTopHot(limit: number): HotnessRow[];
}

export function createHotnessOps(db: Database.Database): HotnessOps {
  const recordStmt = db.prepare(`
    INSERT INTO note_hotness (note_id, retrieval_count, last_accessed)
    VALUES (?, 1, ?)
    ON CONFLICT(note_id) DO UPDATE SET
      retrieval_count = COALESCE(note_hotness.retrieval_count, 0) + 1,
      last_accessed = excluded.last_accessed
  `);

  const getTopStmt = db.prepare(`
    SELECT note_id AS noteId, retrieval_count AS retrievalCount, last_accessed AS lastAccessed
    FROM note_hotness
    ORDER BY retrieval_count DESC
    LIMIT ?
  `);

  return {
    recordAccess(noteId: string): void {
      const now = new Date().toISOString();
      recordStmt.run(noteId, now);
    },

    getHotness(noteIds: string[]): Map<string, { retrievalCount: number; lastAccessed: string }> {
      if (noteIds.length === 0) return new Map();

      const placeholders = noteIds.map(() => '?').join(', ');
      const rows = db
        .prepare(
          `SELECT note_id AS noteId, retrieval_count AS retrievalCount, last_accessed AS lastAccessed
           FROM note_hotness WHERE note_id IN (${placeholders})`,
        )
        .all(...noteIds) as HotnessRow[];

      const result = new Map<string, { retrievalCount: number; lastAccessed: string }>();
      for (const row of rows) {
        result.set(row.noteId, {
          retrievalCount: row.retrievalCount,
          lastAccessed: row.lastAccessed,
        });
      }
      return result;
    },

    getTopHot(limit: number): HotnessRow[] {
      return getTopStmt.all(limit) as HotnessRow[];
    },
  };
}
