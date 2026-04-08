import type Database from 'better-sqlite3';
import type { Logger } from 'pino';

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
    recurrence TEXT DEFAULT NULL,
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

  CREATE TABLE IF NOT EXISTS note_hotness (
    note_id TEXT PRIMARY KEY,
    retrieval_count INTEGER NOT NULL DEFAULT 0,
    last_accessed TEXT NOT NULL,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_note_hotness_count ON note_hotness(retrieval_count DESC);
`;

export interface PreparedStatements {
  upsertNote: Database.Statement;
  updateNoteStatus: Database.Statement;
  softDeleteNote: Database.Statement;
  restoreNote: Database.Statement;
  purgeNote: Database.Statement;
  getNote: Database.Statement;
  getNoteByFilePath: Database.Statement;
  searchFts: Database.Statement;
  searchFtsWithType: Database.Statement;
  listDeletedNotes: Database.Statement;
  upsertReminder: Database.Statement;
  getReminder: Database.Statement;
  listReminders: Database.Statement;
  listAllReminders: Database.Statement;
  listTodos: Database.Statement;
  listAllTodos: Database.Statement;
  upsertSchedule: Database.Statement;
  getSchedule: Database.Statement;
  listSchedules: Database.Statement;
  listAllSchedules: Database.Statement;
  deleteSchedule: Database.Statement;
  upsertMemory: Database.Statement;
  getMemory: Database.Statement;
  listAllMemories: Database.Statement;
  listTopMemories: Database.Statement;
  searchMemory: Database.Statement;
  getPreference: Database.Statement;
  setPreference: Database.Statement;
  getTopTagsWithCounts: Database.Statement;
  renameTag: Database.Statement;
}

function runMigrations(db: Database.Database): void {
  // Migration: add user_preferences table for existing databases
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS user_preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated TEXT NOT NULL
    )`);
  } catch {
    // Table already exists
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
    // Table already exists
  }

  // Migration: add content_hash column
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN content_hash TEXT DEFAULT NULL`);
  } catch {
    // Column already exists
  }

  // Migration: add status and input_source columns
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN status TEXT DEFAULT NULL`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN input_source TEXT DEFAULT NULL`);
  } catch {
    // Column already exists
  }

  // Migration: add image-specific columns
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN image_path TEXT DEFAULT NULL`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN image_url TEXT DEFAULT NULL`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN image_metadata TEXT DEFAULT NULL`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN ocr_text TEXT DEFAULT NULL`);
  } catch {
    // Column already exists
  }

  // Migration: add kind column to reminders
  try {
    db.exec(`ALTER TABLE reminders ADD COLUMN kind TEXT NOT NULL DEFAULT 'reminder'`);
  } catch {
    // Column already exists
  }

  // Migration: add recurrence column to reminders
  try {
    db.exec(`ALTER TABLE reminders ADD COLUMN recurrence TEXT DEFAULT NULL`);
  } catch {
    // Column already exists
  }

  // Migration: add last_surfaced column for knowledge resurfacing
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN last_surfaced TEXT DEFAULT NULL`);
  } catch {
    // Column already exists
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_notes_status_last_surfaced ON notes(last_surfaced, status)`,
  );

  // Migration: add deleted_at column for soft-delete (trash) support
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN deleted_at TEXT DEFAULT NULL`);
  } catch {
    // Column already exists
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_deleted_at ON notes(deleted_at)`);

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
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_revisions_note_id_created ON revisions(note_id, created_at)`,
    );
  } catch {
    // Table already exists
  }

  // Cascade trigger: clean up orphaned revisions
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS revisions_on_note_delete
      AFTER DELETE ON notes
      BEGIN DELETE FROM revisions WHERE note_id = old.id; END;
  `);

  // Migration: add note_hotness table for existing databases (added in v0.19)
  db.exec(`
    CREATE TABLE IF NOT EXISTS note_hotness (
      note_id TEXT PRIMARY KEY,
      retrieval_count INTEGER NOT NULL DEFAULT 0,
      last_accessed TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_note_hotness_count ON note_hotness(retrieval_count DESC)`);
  // Cascade trigger: clean up orphaned hotness rows when a note is hard-deleted.
  // Existing databases may not have the FK (SQLite cannot add FKs to existing tables);
  // this trigger provides the same guarantee for all database ages.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS note_hotness_on_note_delete
      AFTER DELETE ON notes
      BEGIN DELETE FROM note_hotness WHERE note_id = old.id; END;
  `);
}

const NOTE_COLUMNS =
  'id, type, title, content, file_path AS filePath, tags, links, category, source_url AS sourceUrl, author, gist, created, updated, content_hash AS contentHash, status, input_source AS inputSource, image_path AS imagePath, image_url AS imageUrl, image_metadata AS imageMetadata, ocr_text AS ocrText, deleted_at AS deletedAt';

function prepareStatements(db: Database.Database): PreparedStatements {
  return {
    upsertNote: db.prepare(`
      INSERT INTO notes (id, type, title, content, file_path, tags, links, category, source_url, author, gist, created, updated, content_hash, status, input_source, image_path, image_url, image_metadata, ocr_text, deleted_at)
      VALUES (@id, @type, @title, @content, @filePath, @tags, @links, @category, @sourceUrl, @author, @gist, @created, @updated, @contentHash, @status, @inputSource, @imagePath, @imageUrl, @imageMetadata, @ocrText, @deletedAt)
      ON CONFLICT(id) DO UPDATE SET
        title=@title, content=@content, file_path=@filePath, tags=@tags, links=@links,
        category=@category, source_url=@sourceUrl, author=@author, gist=@gist, updated=@updated,
        content_hash=@contentHash, status=@status, input_source=@inputSource, image_path=@imagePath, image_url=@imageUrl, image_metadata=@imageMetadata, ocr_text=@ocrText, deleted_at=@deletedAt
    `),
    updateNoteStatus: db.prepare(`UPDATE notes SET status=?, updated=? WHERE id=?`),
    softDeleteNote: db.prepare(
      `UPDATE notes SET status='deleted', deleted_at=?, file_path=?, updated=? WHERE id=?`,
    ),
    restoreNote: db.prepare(
      `UPDATE notes SET status='saved', deleted_at=NULL, file_path=?, updated=? WHERE id=?`,
    ),
    purgeNote: db.prepare('DELETE FROM notes WHERE id = ?'),
    getNote: db.prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ?`),
    getNoteByFilePath: db.prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE file_path = ?`),
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
      `SELECT ${NOTE_COLUMNS} FROM notes WHERE status = 'deleted' ORDER BY deleted_at DESC`,
    ),
    upsertReminder: db.prepare(`
      INSERT INTO reminders (id, title, description, due_date, priority, completed, kind, recurrence, created, updated)
      VALUES (@id, @title, @description, @dueDate, @priority, @completed, @kind, @recurrence, @created, @updated)
      ON CONFLICT(id) DO UPDATE SET
        title=@title, description=@description, due_date=@dueDate, priority=@priority,
        completed=@completed, kind=@kind, recurrence=@recurrence, updated=@updated
    `),
    getReminder: db.prepare('SELECT * FROM reminders WHERE id = ?'),
    listReminders: db.prepare(
      "SELECT * FROM reminders WHERE kind = ? AND completed = ? ORDER BY due_date ASC",
    ),
    listAllReminders: db.prepare(
      "SELECT * FROM reminders WHERE kind = ? ORDER BY due_date ASC",
    ),
    listTodos: db.prepare(
      "SELECT * FROM reminders WHERE kind = ? AND completed = ? ORDER BY created ASC",
    ),
    listAllTodos: db.prepare(
      "SELECT * FROM reminders WHERE kind = ? ORDER BY created ASC",
    ),
    upsertSchedule: db.prepare(`
      INSERT INTO job_schedules (id, job_type, cron, enabled, description, config, created, updated)
      VALUES (@id, @jobType, @cron, @enabled, @description, @config, @created, @updated)
      ON CONFLICT(id) DO UPDATE SET
        job_type=@jobType, cron=@cron, enabled=@enabled, description=@description, config=@config, updated=@updated
    `),
    getSchedule: db.prepare('SELECT * FROM job_schedules WHERE id = ?'),
    listSchedules: db.prepare(
      'SELECT * FROM job_schedules WHERE enabled = ? ORDER BY id ASC',
    ),
    listAllSchedules: db.prepare('SELECT * FROM job_schedules ORDER BY id ASC'),
    deleteSchedule: db.prepare('DELETE FROM job_schedules WHERE id = ?'),
    upsertMemory: db.prepare(`
      INSERT INTO memory (id, kind, subject, content, confidence, source, created, updated)
      VALUES (@id, @kind, @subject, @content, @confidence, @source, @created, @updated)
      ON CONFLICT(id) DO UPDATE SET
        subject=@subject, content=@content, confidence=@confidence, source=@source, updated=@updated
    `),
    getMemory: db.prepare('SELECT * FROM memory WHERE id = ?'),
    listAllMemories: db.prepare(
      'SELECT * FROM memory ORDER BY confidence DESC, updated DESC',
    ),
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
}

export function initSchema(db: Database.Database, logger: Logger): PreparedStatements {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  runMigrations(db);
  logger.info('SQLite schema initialized');
  return prepareStatements(db);
}
