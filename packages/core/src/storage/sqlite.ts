import Database from 'better-sqlite3';
import type { Logger } from 'pino';
import type { ContentType, NoteMetadata, ReminderEntry, MemoryEntry } from '@echos/shared';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SqliteStorage {
  db: Database.Database;
  // Notes index
  upsertNote(meta: NoteMetadata, content: string, filePath: string): void;
  deleteNote(id: string): void;
  getNote(id: string): NoteRow | undefined;
  listNotes(opts?: ListNotesOptions): NoteRow[];
  searchFts(query: string, opts?: FtsOptions): NoteRow[];
  // Reminders
  upsertReminder(reminder: ReminderEntry): void;
  getReminder(id: string): ReminderEntry | undefined;
  listReminders(completed?: boolean): ReminderEntry[];
  // Memory
  upsertMemory(entry: MemoryEntry): void;
  getMemory(id: string): MemoryEntry | undefined;
  searchMemory(query: string): MemoryEntry[];
  // Lifecycle
  close(): void;
}

export interface NoteRow {
  id: string;
  type: ContentType;
  title: string;
  content: string;
  filePath: string;
  tags: string;
  links: string;
  category: string;
  sourceUrl: string | null;
  author: string | null;
  gist: string | null;
  created: string;
  updated: string;
}

export interface ListNotesOptions {
  type?: ContentType;
  category?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
  orderBy?: 'created' | 'updated' | 'title';
  order?: 'asc' | 'desc';
}

export interface FtsOptions {
  type?: ContentType;
  limit?: number;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    file_path TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '',
    links TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    source_url TEXT,
    author TEXT,
    gist TEXT,
    created TEXT NOT NULL,
    updated TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_notes_type ON notes(type);
  CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category);
  CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created);

  CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    title,
    content,
    tags,
    gist,
    content=notes,
    content_rowid=rowid,
    tokenize='porter unicode61'
  );

  CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, title, content, tags, gist)
    VALUES (new.rowid, new.title, new.content, new.tags, new.gist);
  END;

  CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, content, tags, gist)
    VALUES ('delete', old.rowid, old.title, old.content, old.tags, old.gist);
  END;

  CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, content, tags, gist)
    VALUES ('delete', old.rowid, old.title, old.content, old.tags, old.gist);
    INSERT INTO notes_fts(rowid, title, content, tags, gist)
    VALUES (new.rowid, new.title, new.content, new.tags, new.gist);
  END;

  CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    due_date TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    completed INTEGER NOT NULL DEFAULT 0,
    created TEXT NOT NULL,
    updated TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memory (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    subject TEXT NOT NULL,
    content TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    source TEXT NOT NULL DEFAULT '',
    created TEXT NOT NULL,
    updated TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_memory_kind ON memory(kind);
  CREATE INDEX IF NOT EXISTS idx_memory_subject ON memory(subject);
`;

function rowToReminder(row: Record<string, unknown>): ReminderEntry {
  const entry: ReminderEntry = {
    id: row['id'] as string,
    title: row['title'] as string,
    priority: row['priority'] as ReminderEntry['priority'],
    completed: row['completed'] === 1,
    created: row['created'] as string,
    updated: row['updated'] as string,
  };
  const desc = row['description'] as string | null;
  if (desc) entry.description = desc;
  const due = row['due_date'] as string | null;
  if (due) entry.dueDate = due;
  return entry;
}

export function createSqliteStorage(dbPath: string, logger: Logger): SqliteStorage {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  logger.info({ dbPath }, 'SQLite database initialized');

  // Prepared statements
  const stmts = {
    upsertNote: db.prepare(`
      INSERT INTO notes (id, type, title, content, file_path, tags, links, category, source_url, author, gist, created, updated)
      VALUES (@id, @type, @title, @content, @filePath, @tags, @links, @category, @sourceUrl, @author, @gist, @created, @updated)
      ON CONFLICT(id) DO UPDATE SET
        title=@title, content=@content, file_path=@filePath, tags=@tags, links=@links,
        category=@category, source_url=@sourceUrl, author=@author, gist=@gist, updated=@updated
    `),
    deleteNote: db.prepare('DELETE FROM notes WHERE id = ?'),
    getNote: db.prepare('SELECT * FROM notes WHERE id = ?'),
    listNotes: db.prepare('SELECT * FROM notes ORDER BY created DESC LIMIT ? OFFSET ?'),
    listNotesByType: db.prepare(
      'SELECT * FROM notes WHERE type = ? ORDER BY created DESC LIMIT ? OFFSET ?',
    ),
    searchFts: db.prepare(`
      SELECT notes.*, bm25(notes_fts) as rank
      FROM notes_fts
      JOIN notes ON notes.rowid = notes_fts.rowid
      WHERE notes_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `),
    searchFtsWithType: db.prepare(`
      SELECT notes.*, bm25(notes_fts) as rank
      FROM notes_fts
      JOIN notes ON notes.rowid = notes_fts.rowid
      WHERE notes_fts MATCH ? AND notes.type = ?
      ORDER BY rank
      LIMIT ?
    `),
    upsertReminder: db.prepare(`
      INSERT INTO reminders (id, title, description, due_date, priority, completed, created, updated)
      VALUES (@id, @title, @description, @dueDate, @priority, @completed, @created, @updated)
      ON CONFLICT(id) DO UPDATE SET
        title=@title, description=@description, due_date=@dueDate, priority=@priority,
        completed=@completed, updated=@updated
    `),
    getReminder: db.prepare('SELECT * FROM reminders WHERE id = ?'),
    listReminders: db.prepare('SELECT * FROM reminders WHERE completed = ? ORDER BY due_date ASC'),
    listAllReminders: db.prepare('SELECT * FROM reminders ORDER BY due_date ASC'),
    upsertMemory: db.prepare(`
      INSERT INTO memory (id, kind, subject, content, confidence, source, created, updated)
      VALUES (@id, @kind, @subject, @content, @confidence, @source, @created, @updated)
      ON CONFLICT(id) DO UPDATE SET
        subject=@subject, content=@content, confidence=@confidence, source=@source, updated=@updated
    `),
    getMemory: db.prepare('SELECT * FROM memory WHERE id = ?'),
    searchMemory: db.prepare(
      "SELECT * FROM memory WHERE subject LIKE ? OR content LIKE ? ORDER BY confidence DESC",
    ),
  };

  return {
    db,

    upsertNote(meta: NoteMetadata, content: string, filePath: string): void {
      stmts.upsertNote.run({
        id: meta.id,
        type: meta.type,
        title: meta.title,
        content,
        filePath,
        tags: meta.tags.join(','),
        links: meta.links.join(','),
        category: meta.category,
        sourceUrl: meta.sourceUrl ?? null,
        author: meta.author ?? null,
        gist: meta.gist ?? null,
        created: meta.created,
        updated: meta.updated,
      });
    },

    deleteNote(id: string): void {
      stmts.deleteNote.run(id);
    },

    getNote(id: string): NoteRow | undefined {
      return stmts.getNote.get(id) as NoteRow | undefined;
    },

    listNotes(opts: ListNotesOptions = {}): NoteRow[] {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;

      if (opts.type) {
        return stmts.listNotesByType.all(opts.type, limit, offset) as NoteRow[];
      }
      return stmts.listNotes.all(limit, offset) as NoteRow[];
    },

    searchFts(query: string, opts: FtsOptions = {}): NoteRow[] {
      const limit = opts.limit ?? 20;
      if (opts.type) {
        return stmts.searchFtsWithType.all(query, opts.type, limit) as NoteRow[];
      }
      return stmts.searchFts.all(query, limit) as NoteRow[];
    },

    upsertReminder(reminder: ReminderEntry): void {
      stmts.upsertReminder.run({
        id: reminder.id,
        title: reminder.title,
        description: reminder.description ?? null,
        dueDate: reminder.dueDate ?? null,
        priority: reminder.priority,
        completed: reminder.completed ? 1 : 0,
        created: reminder.created,
        updated: reminder.updated,
      });
    },

    getReminder(id: string): ReminderEntry | undefined {
      const row = stmts.getReminder.get(id) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return rowToReminder(row);
    },

    listReminders(completed?: boolean): ReminderEntry[] {
      const rows =
        completed === undefined
          ? (stmts.listAllReminders.all() as Record<string, unknown>[])
          : (stmts.listReminders.all(completed ? 1 : 0) as Record<string, unknown>[]);
      return rows.map(rowToReminder);
    },

    upsertMemory(entry: MemoryEntry): void {
      stmts.upsertMemory.run({
        id: entry.id,
        kind: entry.kind,
        subject: entry.subject,
        content: entry.content,
        confidence: entry.confidence,
        source: entry.source,
        created: entry.created,
        updated: entry.updated,
      });
    },

    getMemory(id: string): MemoryEntry | undefined {
      const row = stmts.getMemory.get(id) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return {
        id: row['id'] as string,
        kind: row['kind'] as MemoryEntry['kind'],
        subject: row['subject'] as string,
        content: row['content'] as string,
        confidence: row['confidence'] as number,
        source: row['source'] as string,
        created: row['created'] as string,
        updated: row['updated'] as string,
      };
    },

    searchMemory(query: string): MemoryEntry[] {
      const pattern = `%${query}%`;
      const rows = stmts.searchMemory.all(pattern, pattern) as Record<string, unknown>[];
      return rows.map((row) => ({
        id: row['id'] as string,
        kind: row['kind'] as MemoryEntry['kind'],
        subject: row['subject'] as string,
        content: row['content'] as string,
        confidence: row['confidence'] as number,
        source: row['source'] as string,
        created: row['created'] as string,
        updated: row['updated'] as string,
      }));
    },

    close(): void {
      db.close();
      logger.info('SQLite database closed');
    },
  };
}
