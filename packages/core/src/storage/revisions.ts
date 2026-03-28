import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

const MAX_REVISIONS_PER_NOTE = 50;

export interface Revision {
  id: string;
  noteId: string;
  title: string;
  content: string;
  tags: string;
  category: string;
  createdAt: string;
}

export interface RevisionStorage {
  saveRevision(noteId: string, title: string, content: string, tags: string, category: string): string;
  getRevisions(noteId: string, limit?: number): Revision[];
  getRevision(revisionId: string): Revision | undefined;
  pruneRevisions(noteId: string, keepCount?: number): number;
}

function rowToRevision(row: Record<string, unknown>): Revision {
  return {
    id: row['id'] as string,
    noteId: row['note_id'] as string,
    title: row['title'] as string,
    content: row['content'] as string,
    tags: row['tags'] as string,
    category: row['category'] as string,
    createdAt: row['created_at'] as string,
  };
}

export function createRevisionStorage(db: Database.Database): RevisionStorage {
  const stmts = {
    insert: db.prepare(`
      INSERT INTO revisions (id, note_id, title, content, tags, category, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    listByNote: db.prepare(`
      SELECT id, note_id, title, content, tags, category, created_at
      FROM revisions WHERE note_id = ?
      ORDER BY created_at DESC, id DESC LIMIT ?
    `),
    getById: db.prepare(`
      SELECT id, note_id, title, content, tags, category, created_at
      FROM revisions WHERE id = ?
    `),
    countByNote: db.prepare(`SELECT COUNT(*) as cnt FROM revisions WHERE note_id = ?`),
    deleteOldest: db.prepare(`
      DELETE FROM revisions WHERE id IN (
        SELECT id FROM revisions WHERE note_id = ?
        ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?
      )
    `),
  };

  return {
    saveRevision(noteId: string, title: string, content: string, tags: string, category: string): string {
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      stmts.insert.run(id, noteId, title, content, tags, category, createdAt);

      // Auto-prune to keep max revisions
      const countRow = stmts.countByNote.get(noteId) as { cnt: number };
      if (countRow.cnt > MAX_REVISIONS_PER_NOTE) {
        stmts.deleteOldest.run(noteId, MAX_REVISIONS_PER_NOTE);
      }

      return id;
    },

    getRevisions(noteId: string, limit?: number): Revision[] {
      const rows = stmts.listByNote.all(noteId, limit ?? 50) as Record<string, unknown>[];
      return rows.map(rowToRevision);
    },

    getRevision(revisionId: string): Revision | undefined {
      const row = stmts.getById.get(revisionId) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return rowToRevision(row);
    },

    pruneRevisions(noteId: string, keepCount?: number): number {
      const keep = keepCount ?? MAX_REVISIONS_PER_NOTE;
      const countRow = stmts.countByNote.get(noteId) as { cnt: number };
      if (countRow.cnt <= keep) return 0;
      const info = stmts.deleteOldest.run(noteId, keep);
      return info.changes;
    },
  };
}
