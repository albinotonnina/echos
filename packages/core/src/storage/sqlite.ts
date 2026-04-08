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
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { initSchema } from './sqlite-schema.js';
import { createNoteOps } from './sqlite-notes.js';
import { createReminderOps } from './sqlite-reminders.js';
import { createScheduleOps } from './sqlite-schedules.js';
import { createMemoryOps } from './sqlite-memory.js';
import { createStatsOps } from './sqlite-stats.js';
import { createHotnessOps } from './sqlite-hotness.js';
import type { HotnessRow } from './sqlite-hotness.js';
export type { HotnessRow } from './sqlite-hotness.js';

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
  // Hotness tracking
  recordAccess(noteId: string): void;
  getHotness(noteIds: string[]): Map<string, { retrievalCount: number; lastAccessed: string }>;
  /** Returns the most frequently accessed notes. For analytics and debugging. */
  getTopHot(limit: number): HotnessRow[];
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
  /** When true, omits the content column from the result (returns empty string). Use for listing contexts where only metadata is needed. */
  excludeContent?: boolean;
}

export interface FtsOptions {
  type?: ContentType;
  limit?: number;
}

export function createSqliteStorage(dbPath: string, logger: Logger): SqliteStorage {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  const stmts = initSchema(db, logger);
  logger.info({ dbPath }, 'SQLite database initialized');

  return {
    db,
    ...createNoteOps(db, stmts, logger),
    ...createReminderOps(db, stmts, logger),
    ...createScheduleOps(db, stmts, logger),
    ...createMemoryOps(db, stmts, logger),
    ...createStatsOps(db, stmts, logger),
    ...createHotnessOps(db),
    close(): void {
      db.close();
      logger.info('SQLite database closed');
    },
  };
}
