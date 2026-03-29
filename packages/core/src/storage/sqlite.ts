import Database from 'better-sqlite3';
import type { Logger } from 'pino';
import type {
  ContentType,
  ContentStatus,
  NoteMetadata,
  ReminderEntry,
  MemoryEntry,
  ScheduleEntry,
} from '@echos/shared';
import { ValidationError } from '@echos/shared';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SqliteStorage {
  db: Database.Database;
  // Notes index
  upsertNote(meta: NoteMetadata, content: string, filePath: string, contentHash?: string): void;
  updateNoteStatus(id: string, status: ContentStatus): void;
  /** Soft-delete: sets status='deleted', deletedAt=now, and updates file_path to the trash location */
  deleteNote(id: string, trashFilePath?: string): void;
  /** Permanently remove a note row from the database */
  purgeNote(id: string): void;
  /** Restore a soft-deleted note back to 'saved' status and update file_path to the restored location */
  restoreNote(id: string, restoredFilePath?: string): void;
  /** List all soft-deleted notes */
  listDeletedNotes(): NoteRow[];
  getNote(id: string): NoteRow | undefined;
  getNoteByFilePath(filePath: string): NoteRow | undefined;
  listNotes(opts?: ListNotesOptions): NoteRow[];
  searchFts(query: string, opts?: FtsOptions): NoteRow[];
  // Reminders
  upsertReminder(reminder: ReminderEntry): void;
  getReminder(id: string): ReminderEntry | undefined;
  listReminders(completed?: boolean): ReminderEntry[];
  listTodos(completed?: boolean): ReminderEntry[];
  // Schedules
  upsertSchedule(schedule: ScheduleEntry): void;
  getSchedule(id: string): ScheduleEntry | undefined;
  listSchedules(enabledOnly?: boolean): ScheduleEntry[];
  deleteSchedule(id: string): boolean;
  // Memory
  upsertMemory(entry: MemoryEntry): void;
  getMemory(id: string): MemoryEntry | undefined;
  listAllMemories(): MemoryEntry[];
  listTopMemories(limit: number): MemoryEntry[];
  searchMemory(query: string): MemoryEntry[];
  // Tag management
  getTopTagsWithCounts(limit: number): { tag: string; count: number }[];
  renameTag(from: string, to: string): number;
  mergeTags(tags: string[], into: string): number;
  // User preferences
  getAgentVoice(): string | null;
  setAgentVoice(instruction: string): void;
  // Knowledge stats
  getContentTypeCounts(): Record<string, number>;
  getStatusCounts(): Record<string, number>;
  getDistinctTagCount(): number;
  getLinkCount(): number;
  getWeeklyCreationCounts(weeks: number): { week: string; count: number }[];
  getCategoryFrequencies(limit: number): { category: string; count: number }[];
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
  imagePath: string | null;
  imageUrl: string | null;
  imageMetadata: string | null;
  ocrText: string | null;
  deletedAt: string | null;
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
    kind TEXT NOT NULL DEFAULT 'reminder',
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

  CREATE TABLE IF NOT EXISTS job_schedules (
    id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    cron TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    description TEXT NOT NULL DEFAULT '',
    config TEXT NOT NULL DEFAULT '{}',
    created TEXT NOT NULL,
    updated TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS revisions (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_revisions_note_id_created ON revisions(note_id, created_at);
`;

function rowToReminder(row: Record<string, unknown>): ReminderEntry {
  const entry: ReminderEntry = {
    id: row['id'] as string,
    title: row['title'] as string,
    priority: row['priority'] as ReminderEntry['priority'],
    completed: row['completed'] === 1,
    kind: ((row['kind'] as string | null) ?? 'reminder') as ReminderEntry['kind'],
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

function rowToScheduleEntry(row: Record<string, unknown>): ScheduleEntry {
  return {
    id: row['id'] as string,
    jobType: row['job_type'] as string,
    cron: row['cron'] as string,
    enabled: row['enabled'] === 1,
    description: row['description'] as string,
    config: JSON.parse(row['config'] as string) as Record<string, unknown>,
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

  // Migration: add job_schedules table for existing databases
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS job_schedules (
      id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL,
      cron TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      description TEXT NOT NULL DEFAULT '',
      config TEXT NOT NULL DEFAULT '{}',
      created TEXT NOT NULL,
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

  // Migration: add image-specific columns for existing databases
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN image_path TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — that's fine
  }
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN image_url TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — that's fine
  }
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN image_metadata TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — that's fine
  }
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN ocr_text TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — that's fine
  }

  // Migration: add kind column to reminders for existing databases
  try {
    db.exec(`ALTER TABLE reminders ADD COLUMN kind TEXT NOT NULL DEFAULT 'reminder'`);
  } catch {
    // Column already exists — that's fine
  }

  // Migration: add last_surfaced column for knowledge resurfacing
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN last_surfaced TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — that's fine
  }
  // Index for resurfacing queries that filter/order by last_surfaced
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_notes_status_last_surfaced ON notes(last_surfaced, status)`,
  );

  // Migration: add deleted_at column for soft-delete (trash) support
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN deleted_at TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — that's fine
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_notes_deleted_at ON notes(deleted_at)`,
  );

  // Migration: add revisions table for existing databases
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS revisions (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_revisions_note_id_created ON revisions(note_id, created_at)`);
  } catch {
    // Table already exists — that's fine
  }

  // Cascade trigger: clean up orphaned revisions when a note is deleted
  // (covers existing databases where the revisions table was created without FK CASCADE)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS revisions_on_note_delete
      AFTER DELETE ON notes
      BEGIN DELETE FROM revisions WHERE note_id = old.id; END;
  `);

  logger.info({ dbPath }, 'SQLite database initialized');

  // Prepared statements
  const stmts = {
    upsertNote: db.prepare(`
      INSERT INTO notes (id, type, title, content, file_path, tags, links, category, source_url, author, gist, created, updated, content_hash, status, input_source, image_path, image_url, image_metadata, ocr_text, deleted_at)
      VALUES (@id, @type, @title, @content, @filePath, @tags, @links, @category, @sourceUrl, @author, @gist, @created, @updated, @contentHash, @status, @inputSource, @imagePath, @imageUrl, @imageMetadata, @ocrText, @deletedAt)
      ON CONFLICT(id) DO UPDATE SET
        title=@title, content=@content, file_path=@filePath, tags=@tags, links=@links,
        category=@category, source_url=@sourceUrl, author=@author, gist=@gist, updated=@updated,
        content_hash=@contentHash, status=@status, input_source=@inputSource, image_path=@imagePath, image_url=@imageUrl, image_metadata=@imageMetadata, ocr_text=@ocrText, deleted_at=@deletedAt
    `),
    updateNoteStatus: db.prepare(`UPDATE notes SET status=?, updated=? WHERE id=?`),
    softDeleteNote: db.prepare(`UPDATE notes SET status='deleted', deleted_at=?, file_path=?, updated=? WHERE id=?`),
    restoreNote: db.prepare(`UPDATE notes SET status='saved', deleted_at=NULL, file_path=?, updated=? WHERE id=?`),
    purgeNote: db.prepare('DELETE FROM notes WHERE id = ?'),
    getNote: db.prepare(
      'SELECT id, type, title, content, file_path AS filePath, tags, links, category, source_url AS sourceUrl, author, gist, created, updated, content_hash AS contentHash, status, input_source AS inputSource, image_path AS imagePath, image_url AS imageUrl, image_metadata AS imageMetadata, ocr_text AS ocrText, deleted_at AS deletedAt FROM notes WHERE id = ?',
    ),
    getNoteByFilePath: db.prepare(
      'SELECT id, type, title, content, file_path AS filePath, tags, links, category, source_url AS sourceUrl, author, gist, created, updated, content_hash AS contentHash, status, input_source AS inputSource, image_path AS imagePath, image_url AS imageUrl, image_metadata AS imageMetadata, ocr_text AS ocrText, deleted_at AS deletedAt FROM notes WHERE file_path = ?',
    ),
    searchFts: db.prepare(`
      SELECT notes.id, notes.type, notes.title, notes.content, notes.file_path AS filePath, notes.tags, notes.links, notes.category, notes.source_url AS sourceUrl, notes.author, notes.gist, notes.created, notes.updated, notes.content_hash AS contentHash, notes.status, notes.input_source AS inputSource, notes.image_path AS imagePath, notes.image_url AS imageUrl, notes.image_metadata AS imageMetadata, notes.ocr_text AS ocrText, notes.deleted_at AS deletedAt, bm25(notes_fts) as rank
      FROM notes_fts
      JOIN notes ON notes.rowid = notes_fts.rowid
      WHERE notes_fts MATCH ? AND (notes.status IS NULL OR notes.status != 'deleted')
      ORDER BY rank
      LIMIT ?
    `),
    searchFtsWithType: db.prepare(`
      SELECT notes.id, notes.type, notes.title, notes.content, notes.file_path AS filePath, notes.tags, notes.links, notes.category, notes.source_url AS sourceUrl, notes.author, notes.gist, notes.created, notes.updated, notes.content_hash AS contentHash, notes.status, notes.input_source AS inputSource, notes.image_path AS imagePath, notes.image_url AS imageUrl, notes.image_metadata AS imageMetadata, notes.ocr_text AS ocrText, notes.deleted_at AS deletedAt, bm25(notes_fts) as rank
      FROM notes_fts
      JOIN notes ON notes.rowid = notes_fts.rowid
      WHERE notes_fts MATCH ? AND notes.type = ? AND (notes.status IS NULL OR notes.status != 'deleted')
      ORDER BY rank
      LIMIT ?
    `),
    listDeletedNotes: db.prepare(
      "SELECT id, type, title, content, file_path AS filePath, tags, links, category, source_url AS sourceUrl, author, gist, created, updated, content_hash AS contentHash, status, input_source AS inputSource, image_path AS imagePath, image_url AS imageUrl, image_metadata AS imageMetadata, ocr_text AS ocrText, deleted_at AS deletedAt FROM notes WHERE status = 'deleted' ORDER BY deleted_at DESC",
    ),
    upsertReminder: db.prepare(`
      INSERT INTO reminders (id, title, description, due_date, priority, completed, kind, created, updated)
      VALUES (@id, @title, @description, @dueDate, @priority, @completed, @kind, @created, @updated)
      ON CONFLICT(id) DO UPDATE SET
        title=@title, description=@description, due_date=@dueDate, priority=@priority,
        completed=@completed, kind=@kind, updated=@updated
    `),
    getReminder: db.prepare('SELECT * FROM reminders WHERE id = ?'),
    listReminders: db.prepare("SELECT * FROM reminders WHERE kind = ? AND completed = ? ORDER BY due_date ASC"),
    listAllReminders: db.prepare("SELECT * FROM reminders WHERE kind = ? ORDER BY due_date ASC"),
    listTodos: db.prepare("SELECT * FROM reminders WHERE kind = ? AND completed = ? ORDER BY created ASC"),
    listAllTodos: db.prepare("SELECT * FROM reminders WHERE kind = ? ORDER BY created ASC"),
    upsertSchedule: db.prepare(`
      INSERT INTO job_schedules (id, job_type, cron, enabled, description, config, created, updated)
      VALUES (@id, @jobType, @cron, @enabled, @description, @config, @created, @updated)
      ON CONFLICT(id) DO UPDATE SET
        job_type=@jobType, cron=@cron, enabled=@enabled, description=@description, config=@config, updated=@updated
    `),
    getSchedule: db.prepare('SELECT * FROM job_schedules WHERE id = ?'),
    listSchedules: db.prepare('SELECT * FROM job_schedules WHERE enabled = ? ORDER BY id ASC'),
    listAllSchedules: db.prepare('SELECT * FROM job_schedules ORDER BY id ASC'),
    deleteSchedule: db.prepare('DELETE FROM job_schedules WHERE id = ?'),
    upsertMemory: db.prepare(`
      INSERT INTO memory (id, kind, subject, content, confidence, source, created, updated)
      VALUES (@id, @kind, @subject, @content, @confidence, @source, @created, @updated)
      ON CONFLICT(id) DO UPDATE SET
        subject=@subject, content=@content, confidence=@confidence, source=@source, updated=@updated
    `),
    getMemory: db.prepare('SELECT * FROM memory WHERE id = ?'),
    listAllMemories: db.prepare('SELECT * FROM memory ORDER BY confidence DESC, updated DESC'),
    listTopMemories: db.prepare(
      'SELECT * FROM memory ORDER BY confidence DESC, updated DESC LIMIT ?',
    ),
    searchMemory: db.prepare(
      'SELECT * FROM memory WHERE subject LIKE ? OR content LIKE ? ORDER BY confidence DESC',
    ),
    getPreference: db.prepare('SELECT value FROM user_preferences WHERE key = ?'),
    setPreference: db.prepare(`
      INSERT INTO user_preferences (key, value, updated)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated
    `),
    getTopTagsWithCounts: db.prepare(`
      WITH RECURSIVE
        all_tags(rowid, tag, rest) AS (
          SELECT
            rowid,
            CASE WHEN instr(tags || ',', ',') > 0
                 THEN substr(tags || ',', 1, instr(tags || ',', ',') - 1)
                 ELSE tags END,
            CASE WHEN instr(tags || ',', ',') > 0
                 THEN substr(tags || ',', instr(tags || ',', ',') + 1)
                 ELSE '' END
          FROM notes WHERE tags != '' AND (status IS NULL OR status != 'deleted')
          UNION ALL
          SELECT
            rowid,
            CASE WHEN instr(rest, ',') > 0
                 THEN substr(rest, 1, instr(rest, ',') - 1)
                 ELSE rest END,
            CASE WHEN instr(rest, ',') > 0
                 THEN substr(rest, instr(rest, ',') + 1)
                 ELSE '' END
          FROM all_tags WHERE rest != ''
        )
      SELECT tag, COUNT(DISTINCT rowid) as count
      FROM all_tags WHERE tag != ''
      GROUP BY tag ORDER BY count DESC, tag ASC
      LIMIT ?
    `),
    renameTag: db.prepare(`
      UPDATE notes
      SET tags = (
            WITH RECURSIVE
              split(tag, rest) AS (
                SELECT
                  CASE WHEN instr(tags || ',', ',') > 0
                       THEN substr(tags || ',', 1, instr(tags || ',', ',') - 1)
                       ELSE tags END,
                  CASE WHEN instr(tags || ',', ',') > 0
                       THEN substr(tags || ',', instr(tags || ',', ',') + 1)
                       ELSE '' END
                UNION ALL
                SELECT
                  CASE WHEN instr(rest, ',') > 0
                       THEN substr(rest, 1, instr(rest, ',') - 1)
                       ELSE rest END,
                  CASE WHEN instr(rest, ',') > 0
                       THEN substr(rest, instr(rest, ',') + 1)
                       ELSE '' END
                FROM split WHERE rest != ''
              )
            SELECT GROUP_CONCAT(mapped_tag)
            FROM (
              SELECT DISTINCT CASE WHEN tag = ? THEN ? ELSE tag END AS mapped_tag
              FROM split
              WHERE tag != ''
              ORDER BY LOWER(mapped_tag)
            )
          ),
          updated = ?
      WHERE INSTR(',' || tags || ',', ',' || ? || ',') > 0
    `),
  };

  return {
    db,

    upsertNote(meta: NoteMetadata, content: string, filePath: string, contentHash?: string): void {
      for (const tag of meta.tags ?? []) {
        if (tag.includes(',')) {
          throw new ValidationError(`Tag "${tag}" must not contain commas`);
        }
      }
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
        imagePath: meta.imagePath ?? null,
        imageUrl: meta.imageUrl ?? null,
        imageMetadata: meta.imageMetadata ?? null,
        ocrText: meta.ocrText ?? null,
        deletedAt: meta.deletedAt ?? null,
      });
    },

    updateNoteStatus(id: string, status: ContentStatus): void {
      stmts.updateNoteStatus.run(status, new Date().toISOString(), id);
    },

    deleteNote(id: string, trashFilePath?: string): void {
      const now = new Date().toISOString();
      const row = stmts.getNote.get(id) as NoteRow | undefined;
      const filePath = trashFilePath ?? row?.filePath ?? '';
      stmts.softDeleteNote.run(now, filePath, now, id);
    },

    purgeNote(id: string): void {
      stmts.purgeNote.run(id);
    },

    restoreNote(id: string, restoredFilePath?: string): void {
      const now = new Date().toISOString();
      const row = stmts.getNote.get(id) as NoteRow | undefined;
      const filePath = restoredFilePath ?? row?.filePath ?? '';
      stmts.restoreNote.run(filePath, now, id);
    },

    listDeletedNotes(): NoteRow[] {
      return stmts.listDeletedNotes.all() as NoteRow[];
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

      // Exclude deleted notes by default unless explicitly requesting deleted status
      if (opts.status) {
        conditions.push('status = ?');
        params.push(opts.status);
      } else {
        conditions.push("(status IS NULL OR status != 'deleted')");
      }

      if (opts.type) {
        conditions.push('type = ?');
        params.push(opts.type);
      }
      if (opts.dateFrom) {
        conditions.push('created >= ?');
        params.push(opts.dateFrom);
      }
      if (opts.dateTo) {
        conditions.push('created <= ?');
        params.push(opts.dateTo);
      }
      if (opts.tags && opts.tags.length > 0) {
        for (const tag of opts.tags) {
          conditions.push("INSTR(',' || tags || ',', ',' || ? || ',') > 0");
          params.push(tag);
        }
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      // limit: 0 means "no limit" — omit the LIMIT/OFFSET clause entirely
      const pagination = limit > 0 ? ' LIMIT ? OFFSET ?' : '';
      const sql = `SELECT id, type, title, content, file_path AS filePath, tags, links, category, source_url AS sourceUrl, author, gist, created, updated, content_hash AS contentHash, status, input_source AS inputSource, image_path AS imagePath, image_url AS imageUrl, image_metadata AS imageMetadata, ocr_text AS ocrText, deleted_at AS deletedAt FROM notes ${where} ORDER BY created DESC${pagination}`;
      if (limit > 0) params.push(limit, offset);

      return db.prepare(sql).all(...params) as NoteRow[];
    },

    searchFts(query: string, opts: FtsOptions = {}): NoteRow[] {
      const limit = opts.limit ?? 20;
      // Sanitize for FTS5: strip special syntax characters and quote each term
      const sanitized = query
        .replace(/[""*(){}[\]:^~!@#$%&\\|/<>]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 0)
        .map((w) => `"${w.replace(/"/g, '')}"`)
        .join(' ');
      if (!sanitized) return [];
      if (opts.type) {
        return stmts.searchFtsWithType.all(sanitized, opts.type, limit) as NoteRow[];
      }
      return stmts.searchFts.all(sanitized, limit) as NoteRow[];
    },

    upsertReminder(reminder: ReminderEntry): void {
      stmts.upsertReminder.run({
        id: reminder.id,
        title: reminder.title,
        description: reminder.description ?? null,
        dueDate: reminder.dueDate ?? null,
        priority: reminder.priority,
        completed: reminder.completed ? 1 : 0,
        kind: reminder.kind,
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
          ? (stmts.listAllReminders.all('reminder') as Record<string, unknown>[])
          : (stmts.listReminders.all('reminder', completed ? 1 : 0) as Record<string, unknown>[]);
      return rows.map(rowToReminder);
    },

    listTodos(completed?: boolean): ReminderEntry[] {
      const rows =
        completed === undefined
          ? (stmts.listAllTodos.all('todo') as Record<string, unknown>[])
          : (stmts.listTodos.all('todo', completed ? 1 : 0) as Record<string, unknown>[]);
      return rows.map(rowToReminder);
    },

    upsertSchedule(schedule: ScheduleEntry): void {
      stmts.upsertSchedule.run({
        id: schedule.id,
        jobType: schedule.jobType,
        cron: schedule.cron,
        enabled: schedule.enabled ? 1 : 0,
        description: schedule.description,
        config: JSON.stringify(schedule.config),
        created: schedule.created,
        updated: schedule.updated,
      });
    },

    getSchedule(id: string): ScheduleEntry | undefined {
      const row = stmts.getSchedule.get(id) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return rowToScheduleEntry(row);
    },

    listSchedules(enabledOnly?: boolean): ScheduleEntry[] {
      const rows =
        enabledOnly === undefined
          ? (stmts.listAllSchedules.all() as Record<string, unknown>[])
          : (stmts.listSchedules.all(enabledOnly ? 1 : 0) as Record<string, unknown>[]);
      return rows.map(rowToScheduleEntry);
    },

    deleteSchedule(id: string): boolean {
      const info = stmts.deleteSchedule.run(id);
      return info.changes > 0;
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

    getTopTagsWithCounts(limit: number): { tag: string; count: number }[] {
      return stmts.getTopTagsWithCounts.all(limit) as { tag: string; count: number }[];
    },

    renameTag(from: string, to: string): number {
      const now = new Date().toISOString();
      const info = stmts.renameTag.run(from, to, now, from) as Database.RunResult;
      return info.changes;
    },

    /**
     * Merge multiple source tags into a single target tag.
     *
     * Returns the total number of UPDATE operations (rows affected) across all
     * tag renames. If a single note contains multiple source tags, it may be
     * updated multiple times and therefore counted multiple times in this total.
     */
    mergeTags(tags: string[], into: string): number {
      return db.transaction((): number => {
        const now = new Date().toISOString();
        let totalUpdates = 0;
        for (const from of tags) {
          if (from === into) continue;
          const info = stmts.renameTag.run(from, into, now, from) as Database.RunResult;
          totalUpdates += info.changes;
        }
        return totalUpdates;
      })();
    },

    getAgentVoice(): string | null {
      const row = stmts.getPreference.get('agent_voice') as { value: string } | undefined;
      return row?.value ?? null;
    },

    setAgentVoice(instruction: string): void {
      stmts.setPreference.run('agent_voice', instruction, new Date().toISOString());
    },

    getContentTypeCounts(): Record<string, number> {
      const rows = db
        .prepare(
          `SELECT type, COUNT(*) AS count FROM notes
           WHERE status IS NULL OR status != 'deleted'
           GROUP BY type`,
        )
        .all() as { type: string; count: number }[];
      const result: Record<string, number> = {};
      for (const row of rows) {
        result[row.type] = row.count;
      }
      return result;
    },

    getStatusCounts(): Record<string, number> {
      const row = db
        .prepare(
          `SELECT
            SUM(CASE WHEN status = 'saved'    THEN 1 ELSE 0 END) AS saved,
            SUM(CASE WHEN status = 'read'     THEN 1 ELSE 0 END) AS read,
            SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived,
            SUM(CASE WHEN status IS NULL      THEN 1 ELSE 0 END) AS unset
           FROM notes WHERE status IS NULL OR status != 'deleted'`,
        )
        .get() as { saved: number | null; read: number | null; archived: number | null; unset: number | null };
      return {
        saved: row.saved ?? 0,
        read: row.read ?? 0,
        archived: row.archived ?? 0,
        unset: row.unset ?? 0,
      };
    },

    getDistinctTagCount(): number {
      const row = db
        .prepare(
          `WITH RECURSIVE
            all_tags(tag, rest) AS (
              SELECT
                CASE WHEN instr(tags || ',', ',') > 0
                     THEN substr(tags || ',', 1, instr(tags || ',', ',') - 1)
                     ELSE tags END,
                CASE WHEN instr(tags || ',', ',') > 0
                     THEN substr(tags || ',', instr(tags || ',', ',') + 1)
                     ELSE '' END
              FROM notes WHERE tags != '' AND (status IS NULL OR status != 'deleted')
              UNION ALL
              SELECT
                CASE WHEN instr(rest, ',') > 0
                     THEN substr(rest, 1, instr(rest, ',') - 1)
                     ELSE rest END,
                CASE WHEN instr(rest, ',') > 0
                     THEN substr(rest, instr(rest, ',') + 1)
                     ELSE '' END
              FROM all_tags WHERE rest != ''
            )
          SELECT COUNT(DISTINCT tag) AS distinctTags FROM all_tags WHERE tag != ''`,
        )
        .get() as { distinctTags: number };
      return row.distinctTags ?? 0;
    },

    getLinkCount(): number {
      const row = db
        .prepare(
          `SELECT SUM(
            CASE
              WHEN links IS NULL OR links = '' THEN 0
              ELSE LENGTH(links) - LENGTH(REPLACE(links, ',', '')) + 1
            END
           ) AS linkCount
           FROM notes WHERE status IS NULL OR status != 'deleted'`,
        )
        .get() as { linkCount: number | null };
      return row.linkCount ?? 0;
    },

    getWeeklyCreationCounts(weeks: number): { week: string; count: number }[] {
      const cutoff = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000).toISOString();
      return db
        .prepare(
          `SELECT strftime('%Y-W%W', created) AS week, COUNT(*) AS count
           FROM notes
           WHERE created >= ? AND (status IS NULL OR status != 'deleted')
           GROUP BY week
           ORDER BY week ASC`,
        )
        .all(cutoff) as { week: string; count: number }[];
    },

    getCategoryFrequencies(limit: number): { category: string; count: number }[] {
      return db
        .prepare(
          `SELECT category, COUNT(*) AS count
           FROM notes
           WHERE category != '' AND (status IS NULL OR status != 'deleted')
           GROUP BY category
           ORDER BY count DESC, category ASC
           LIMIT ?`,
        )
        .all(limit) as { category: string; count: number }[];
    },

    close(): void {
      db.close();
      logger.info('SQLite database closed');
    },
  };
}
