import type Database from 'better-sqlite3';
import type { Logger } from 'pino';
import type { ContentStatus, NoteMetadata } from '@echos/shared';
import { ValidationError } from '@echos/shared';
import type { PreparedStatements } from './sqlite-schema.js';
import type { NoteRow, ListNotesOptions, FtsOptions } from './sqlite.js';

export interface NoteOps {
  upsertNote(meta: NoteMetadata, content: string, filePath: string, contentHash?: string): void;
  updateNoteStatus(id: string, status: ContentStatus): void;
  deleteNote(id: string, trashFilePath?: string): void;
  purgeNote(id: string): void;
  restoreNote(id: string, restoredFilePath?: string): void;
  listDeletedNotes(): NoteRow[];
  getNote(id: string): NoteRow | undefined;
  getNoteByFilePath(filePath: string): NoteRow | undefined;
  listNotes(opts?: ListNotesOptions): NoteRow[];
  searchFts(query: string, opts?: FtsOptions): NoteRow[];
}

export function createNoteOps(
  db: Database.Database,
  stmts: PreparedStatements,
  _logger: Logger,
): NoteOps {
  return {
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
      if (opts.category) {
        conditions.push('category = ?');
        params.push(opts.category);
      }
      if (opts.tags && opts.tags.length > 0) {
        for (const tag of opts.tags) {
          conditions.push("INSTR(',' || tags || ',', ',' || ? || ',') > 0");
          params.push(tag);
        }
      }

      const contentCol = opts.excludeContent ? "'' AS content" : 'content';
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const pagination = limit > 0 ? ' LIMIT ? OFFSET ?' : '';
      const sql = `SELECT id, type, title, ${contentCol}, file_path AS filePath, tags, links, category, source_url AS sourceUrl, author, gist, created, updated, content_hash AS contentHash, status, input_source AS inputSource, image_path AS imagePath, image_url AS imageUrl, image_metadata AS imageMetadata, ocr_text AS ocrText, deleted_at AS deletedAt FROM notes ${where} ORDER BY created DESC${pagination}`;
      if (limit > 0) params.push(limit, offset);

      return db.prepare(sql).all(...params) as NoteRow[];
    },

    searchFts(query: string, opts: FtsOptions = {}): NoteRow[] {
      const limit = opts.limit ?? 20;
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
  };
}
