import type Database from 'better-sqlite3';

export interface HotnessRow {
  noteId: string;
  retrievalCount: number;
  lastAccessed: string;
}

export interface HotnessOps {
  /**
   * Increment the retrieval count for a note and update its last-accessed timestamp.
   * Idempotent: safe to call repeatedly; uses INSERT OR REPLACE with coalesced counter.
   */
  recordAccess(noteId: string): void;

  /**
   * Batch lookup of hotness data for a set of note IDs.
   * Notes not yet in the table are absent from the returned Map (treat as count=0).
   */
  getHotness(noteIds: string[]): Map<string, { retrievalCount: number; lastAccessed: string }>;

  /** Return the most-accessed notes, ordered by retrieval_count DESC. */
  getTopHot(limit: number): HotnessRow[];
}

/** sigmoid(x) = 1 / (1 + e^(-x)) */
export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Compute the hotness score multiplier for a note.
 *
 * Formula: sigmoid(log1p(retrievalCount)) * temporalDecay(lastAccessed, halfLifeDays)
 *
 * This combines:
 * - A bounded popularity signal (sigmoid compresses any retrieval count to 0–1)
 * - A recency signal that decays a frequently-accessed-but-stale note back toward 0
 *
 * Returns a value in (0, 1]. Notes with no history return 0 (caller handles gracefully).
 */
export function computeHotness(
  retrievalCount: number,
  lastAccessed: string,
  halfLifeDays: number,
  computeDecay: (createdAt: string, halfLife: number) => number,
): number {
  const popularity = sigmoid(Math.log1p(retrievalCount));
  const recency = computeDecay(lastAccessed, halfLifeDays);
  return popularity * recency;
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS note_hotness (
    note_id TEXT PRIMARY KEY,
    retrieval_count INTEGER NOT NULL DEFAULT 0,
    last_accessed TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_note_hotness_retrieval ON note_hotness(retrieval_count DESC);
`;

export function initHotnessSchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
}

export function createHotnessOps(db: Database.Database): HotnessOps {
  const recordAccessStmt = db.prepare(`
    INSERT INTO note_hotness (note_id, retrieval_count, last_accessed)
    VALUES (?, 1, ?)
    ON CONFLICT(note_id) DO UPDATE SET
      retrieval_count = retrieval_count + 1,
      last_accessed = excluded.last_accessed
  `);

  const getTopHotStmt = db.prepare(`
    SELECT note_id AS noteId, retrieval_count AS retrievalCount, last_accessed AS lastAccessed
    FROM note_hotness
    ORDER BY retrieval_count DESC
    LIMIT ?
  `);

  return {
    recordAccess(noteId: string): void {
      recordAccessStmt.run(noteId, new Date().toISOString());
    },

    getHotness(noteIds: string[]): Map<string, { retrievalCount: number; lastAccessed: string }> {
      const result = new Map<string, { retrievalCount: number; lastAccessed: string }>();
      if (noteIds.length === 0) return result;

      // SQLite has a limit of 999 bound parameters; chunk if needed
      const chunkSize = 900;
      for (let i = 0; i < noteIds.length; i += chunkSize) {
        const chunk = noteIds.slice(i, i + chunkSize);
        const placeholders = chunk.map(() => '?').join(',');
        const rows = db
          .prepare(
            `SELECT note_id AS noteId, retrieval_count AS retrievalCount, last_accessed AS lastAccessed
             FROM note_hotness WHERE note_id IN (${placeholders})`,
          )
          .all(...chunk) as HotnessRow[];
        for (const row of rows) {
          result.set(row.noteId, {
            retrievalCount: row.retrievalCount,
            lastAccessed: row.lastAccessed,
          });
        }
      }
      return result;
    },

    getTopHot(limit: number): HotnessRow[] {
      return getTopHotStmt.all(limit) as HotnessRow[];
    },
  };
}
