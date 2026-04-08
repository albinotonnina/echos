import type Database from 'better-sqlite3';

export interface HotnessRow {
  noteId: string;
  retrievalCount: number;
  lastAccessed: string;
}

export interface HotnessOps {
  recordAccess(noteId: string): void;
  getHotness(noteIds: string[]): Map<string, { retrievalCount: number; lastAccessed: string }>;
  /** Returns the most frequently accessed notes. Intended for analytics and debugging (e.g. "what have I been reading most?"). */
  getTopHot(limit: number): HotnessRow[];
}

export function createHotnessOps(db: Database.Database): HotnessOps {
  const stmtUpsert = db.prepare(`
    INSERT INTO note_hotness (note_id, retrieval_count, last_accessed)
    VALUES (?, 1, ?)
    ON CONFLICT(note_id) DO UPDATE SET
      retrieval_count = retrieval_count + 1,
      last_accessed = excluded.last_accessed
  `);

  const stmtGetTopHot = db.prepare(`
    SELECT note_id AS noteId, retrieval_count AS retrievalCount, last_accessed AS lastAccessed
    FROM note_hotness
    ORDER BY retrieval_count DESC, last_accessed DESC
    LIMIT ?
  `);

  // Cache prepared statements for getHotness by placeholder count to avoid
  // re-preparing on every call (which happens frequently, on every hybrid search).
  const stmtGetHotnessCache = new Map<number, Database.Statement>();
  function getHotnessStmt(count: number): Database.Statement {
    let stmt = stmtGetHotnessCache.get(count);
    if (!stmt) {
      const placeholders = Array(count).fill('?').join(', ');
      stmt = db.prepare(
        `SELECT note_id AS noteId, retrieval_count AS retrievalCount, last_accessed AS lastAccessed
         FROM note_hotness WHERE note_id IN (${placeholders})`,
      );
      stmtGetHotnessCache.set(count, stmt);
    }
    return stmt;
  }

  return {
    recordAccess(noteId: string): void {
      stmtUpsert.run(noteId, new Date().toISOString());
    },

    getHotness(noteIds: string[]): Map<string, { retrievalCount: number; lastAccessed: string }> {
      if (noteIds.length === 0) return new Map();

      const rows = getHotnessStmt(noteIds.length).all(...noteIds) as HotnessRow[];

      const result = new Map<string, { retrievalCount: number; lastAccessed: string }>();
      for (const row of rows) {
        result.set(row.noteId, { retrievalCount: row.retrievalCount, lastAccessed: row.lastAccessed });
      }
      return result;
    },

    getTopHot(limit: number): HotnessRow[] {
      return stmtGetTopHot.all(limit) as HotnessRow[];
    },
  };
}
