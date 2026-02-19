import Database from 'better-sqlite3';
import type { Logger } from 'pino';
import type { ContentType, ContentStatus, NoteMetadata, ReminderEntry, MemoryEntry } from '@echos/shared';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SqliteStorage {
  db: Database.Database;
  // Notes index
  upsertNote(meta: NoteMetadata, content: string, filePath: string, contentHash?: string): void;
  updateNoteStatus(id: string, status: ContentStatus): void;
  deleteNote(id: string): void;
  getNote(id: string): NoteRow | undefined;
  getNoteByFilePath(filePath: string): NoteRow | undefined;
  listNotes(opts?: ListNotesOptions): NoteRow[];
  searchFts(query: string, opts?: FtsOptions): NoteRow[];
  // Reminders
  upsertReminder(reminder: ReminderEntry): void;
  getReminder(id: string): ReminderEntry | undefined;
  listReminders(completed?: boolean): ReminderEntry[];
  // Memory
  upsertMemory(entry: MemoryEntry): void;
  getMemory(id: string): MemoryEntry | undefined;
  listAllMemories(): MemoryEntry[];
  listTopMemories(limit: number): MemoryEntry[];
  searchMemory(query: string): MemoryEntry[];
  // User preferences
  getAgentVoice(): string | null;
  setAgentVoice(instruction: string): void;
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
  contentHash: string | null;
  status: ContentStatus | null;
  inputSource: string | null;
}

export interface ListNotesOptions {
  type?: ContentType;
  category?: string;
  tags?: string[];
  status?: ContentStatus;
  dateFrom?: string;
  dateTo?: string;
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
    updated TEXT NOT NULL,
    content_hash TEXT DEFAULT NULL,
    status TEXT DEFAULT NULL,
    input_source TEXT DEFAULT NULL
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

  CREATE TABLE IF NOT EXISTS user_preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated TEXT NOT NULL
  );
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

function rowToMemory(row: Record<string, unknown>): MemoryEntry {
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
}

export function createSqliteStorage(dbPath: string, logger: Logger): SqliteStorage {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  // Migration: add user_preferences table for existing databases
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS user_preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated TEXT NOT NULL
    )`);
  } catch {
    // Table already exists — that's fine
  }

  // Migration: add content_hash column for existing databases
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN content_hash TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — that's fine
  }

  // Migration: add status and input_source columns for existing databases
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN status TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — that's fine
  }
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN input_source TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — that's fine
  }

  logger.info({ dbPath }, 'SQLite database initialized');

  // Prepared statements
  const stmts = {
    upsertNote: db.prepare(`
      INSERT INTO notes (id, type, title, content, file_path, tags, links, category, source_url, author, gist, created, updated, content_hash, status, input_source)
      VALUES (@id, @type, @title, @content, @filePath, @tags, @links, @category, @sourceUrl, @author, @gist, @created, @updated, @contentHash, @status, @inputSource)
      ON CONFLICT(id) DO UPDATE SET
        title=@title, content=@content, file_path=@filePath, tags=@tags, links=@links,
        category=@category, source_url=@sourceUrl, author=@author, gist=@gist, updated=@updated,
        content_hash=@contentHash, status=@status, input_source=@inputSource
    `),
    updateNoteStatus: db.prepare(`UPDATE notes SET status=?, updated=? WHERE id=?`),
    deleteNote: db.prepare('DELETE FROM notes WHERE id = ?'),
    getNote: db.prepare(
      'SELECT id, type, title, content, file_path AS filePath, tags, links, category, source_url AS sourceUrl, author, gist, created, updated, content_hash AS contentHash, status, input_source AS inputSource FROM notes WHERE id = ?',
    ),
    getNoteByFilePath: db.prepare(
      'SELECT id, type, title, content, file_path AS filePath, tags, links, category, source_url AS sourceUrl, author, gist, created, updated, content_hash AS contentHash, status, input_source AS inputSource FROM notes WHERE file_path = ?',
    ),
    searchFts: db.prepare(`
      SELECT notes.id, notes.type, notes.title, notes.content, notes.file_path AS filePath, notes.tags, notes.links, notes.category, notes.source_url AS sourceUrl, notes.author, notes.gist, notes.created, notes.updated, notes.content_hash AS contentHash, notes.status, notes.input_source AS inputSource, bm25(notes_fts) as rank
      FROM notes_fts
      JOIN notes ON notes.rowid = notes_fts.rowid
      WHERE notes_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `),
    searchFtsWithType: db.prepare(`
      SELECT notes.id, notes.type, notes.title, notes.content, notes.file_path AS filePath, notes.tags, notes.links, notes.category, notes.source_url AS sourceUrl, notes.author, notes.gist, notes.created, notes.updated, notes.content_hash AS contentHash, notes.status, notes.input_source AS inputSource, bm25(notes_fts) as rank
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
    listAllMemories: db.prepare('SELECT * FROM memory ORDER BY confidence DESC, updated DESC'),
    listTopMemories: db.prepare('SELECT * FROM memory ORDER BY confidence DESC, updated DESC LIMIT ?'),
    searchMemory: db.prepare(
      "SELECT * FROM memory WHERE subject LIKE ? OR content LIKE ? ORDER BY confidence DESC",
    ),
    getPreference: db.prepare('SELECT value FROM user_preferences WHERE key = ?'),
    setPreference: db.prepare(`
      INSERT INTO user_preferences (key, value, updated)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated
    `),
  };

  return {
    db,

    upsertNote(meta: NoteMetadata, content: string, filePath: string, contentHash?: string): void {
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
        contentHash: contentHash ?? null,
        status: meta.status ?? null,
        inputSource: meta.inputSource ?? null,
      });
    },

    updateNoteStatus(id: string, status: ContentStatus): void {
      stmts.updateNoteStatus.run(status, new Date().toISOString(), id);
    },

    deleteNote(id: string): void {
      stmts.deleteNote.run(id);
    },

    getNote(id: string): NoteRow | undefined {
      return stmts.getNote.get(id) as NoteRow | undefined;
    },

    getNoteByFilePath(filePath: string): NoteRow | undefined {
      return stmts.getNoteByFilePath.get(filePath) as NoteRow | undefined;
    },

    listNotes(opts: ListNotesOptions = {}): NoteRow[] {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (opts.type) { conditions.push('type = ?'); params.push(opts.type); }
      if (opts.status) { conditions.push('status = ?'); params.push(opts.status); }
      if (opts.dateFrom) { conditions.push('created >= ?'); params.push(opts.dateFrom); }
      if (opts.dateTo) { conditions.push('created <= ?'); params.push(opts.dateTo); }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const sql = `SELECT id, type, title, content, file_path AS filePath, tags, links, category, source_url AS sourceUrl, author, gist, created, updated, content_hash AS contentHash, status, input_source AS inputSource FROM notes ${where} ORDER BY created DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      return db.prepare(sql).all(...params) as NoteRow[];
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
      return rowToMemory(row);
    },

    listAllMemories(): MemoryEntry[] {
      const rows = stmts.listAllMemories.all() as Record<string, unknown>[];
      return rows.map(rowToMemory);
    },

    listTopMemories(limit: number): MemoryEntry[] {
      const rows = stmts.listTopMemories.all(limit) as Record<string, unknown>[];
      return rows.map(rowToMemory);
    },

    searchMemory(query: string): MemoryEntry[] {
      const seen = new Set<string>();
      const results: MemoryEntry[] = [];

      const addRows = (rows: Record<string, unknown>[]) => {
        for (const row of rows) {
          const id = row['id'] as string;
          if (!seen.has(id)) {
            seen.add(id);
            results.push(rowToMemory(row));
          }
        }
      };

      // Exact phrase match
      const pattern = `%${query}%`;
      addRows(stmts.searchMemory.all(pattern, pattern) as Record<string, unknown>[]);

      // Individual word matches for multi-word queries
      const words = query.split(/\s+/).filter((w) => w.length > 2);
      for (const word of words) {
        const wordPattern = `%${word}%`;
        addRows(stmts.searchMemory.all(wordPattern, wordPattern) as Record<string, unknown>[]);
      }

      return results.sort((a, b) => b.confidence - a.confidence);
    },

    getAgentVoice(): string | null {
      const row = stmts.getPreference.get('agent_voice') as { value: string } | undefined;
      return row?.value ?? null;
    },

    setAgentVoice(instruction: string): void {
      stmts.setPreference.run('agent_voice', instruction, new Date().toISOString());
    },

    close(): void {
      db.close();
      logger.info('SQLite database closed');
    },
  };
}
