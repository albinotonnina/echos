import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { Logger } from 'pino';
import type { SqliteStorage } from './sqlite.js';
import type { VectorStorage } from './vectordb.js';
import type { MarkdownStorage } from './markdown.js';
import type { NoteMetadata, ContentStatus, InputSource } from '@echos/shared';

export interface ReconcileOptions {
  baseDir: string;
  sqlite: SqliteStorage;
  vectorDb: VectorStorage;
  markdown: MarkdownStorage;
  generateEmbedding: (text: string) => Promise<number[]>;
  logger: Logger;
}

export interface ReconcileStats {
  scanned: number;
  added: number;
  updated: number;
  skipped: number;
  deleted: number;
}

export function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// macOS resource fork / metadata files — always safe to ignore
const IGNORED_PREFIXES = ['._', '.DS_Store'];

function isIgnoredFile(name: string): boolean {
  return IGNORED_PREFIXES.some(prefix => name.startsWith(prefix));
}

function scanMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const paths: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (isIgnoredFile(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      paths.push(...scanMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      paths.push(fullPath);
    }
  }
  return paths;
}

export async function reconcileStorage(opts: ReconcileOptions): Promise<ReconcileStats> {
  const { baseDir, sqlite, vectorDb, markdown, generateEmbedding, logger } = opts;
  const stats: ReconcileStats = { scanned: 0, added: 0, updated: 0, skipped: 0, deleted: 0 };

  logger.info({ baseDir }, 'Starting storage reconciliation');

  const filePaths = scanMarkdownFiles(baseDir);
  stats.scanned = filePaths.length;

  const seenIds = new Set<string>();

  for (const filePath of filePaths) {
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch {
      logger.warn({ filePath }, 'Reconciler: could not read file, skipping');
      continue;
    }

    let data: Record<string, unknown>;
    let content: string;
    try {
      const parsed = matter(raw);
      data = parsed.data;
      content = parsed.content.trim();
    } catch {
      logger.warn({ filePath }, 'Reconciler: could not parse frontmatter, skipping');
      continue;
    }

    const id = data['id'] as string | undefined;
    if (!id) {
      logger.warn({ filePath }, 'Reconciler: file missing id in frontmatter, skipping');
      continue;
    }

    seenIds.add(id);
    markdown.registerFile(id, filePath);

    const contentHash = computeContentHash(content);
    const existing = sqlite.getNote(id);

    if (!existing) {
      // New file — index it fully
      const meta = buildMetadata(data);
      sqlite.upsertNote(meta, content, filePath, contentHash);
      await upsertVector(id, meta, content, vectorDb, generateEmbedding, logger);
      stats.added++;
      logger.debug({ id, filePath }, 'Reconciler: added new note');
    } else if (existing.contentHash !== contentHash) {
      // Content changed — update SQLite and re-embed
      const meta = buildMetadata(data);
      sqlite.upsertNote(meta, content, filePath, contentHash);
      await upsertVector(id, meta, content, vectorDb, generateEmbedding, logger);
      stats.updated++;
      logger.debug({ id, filePath }, 'Reconciler: updated changed note');
    } else if (existing.filePath !== filePath) {
      // Only path changed (file moved) — update SQLite, skip re-embedding
      const meta = buildMetadata(data);
      sqlite.upsertNote(meta, content, filePath, contentHash);
      stats.updated++;
      logger.debug({ id, filePath }, 'Reconciler: updated moved note path');
    } else {
      // Content and path unchanged — check if frontmatter metadata changed
      const meta = buildMetadata(data);
      const metaChanged =
        existing.type !== meta.type ||
        existing.title !== meta.title ||
        existing.tags !== meta.tags.join(',') ||
        existing.category !== meta.category;
      if (metaChanged) {
        sqlite.upsertNote(meta, content, filePath, contentHash);
        stats.updated++;
        logger.debug({ id, filePath }, 'Reconciler: updated frontmatter-only change');
      } else {
        stats.skipped++;
      }
    }
  }

  // Remove SQLite/LanceDB records for files that no longer exist on disk
  const allNotes = sqlite.listNotes({ limit: 0 });
  for (const row of allNotes) {
    if (!seenIds.has(row.id)) {
      sqlite.deleteNote(row.id);
      await vectorDb.remove(row.id);
      markdown.unregisterFile(row.filePath);
      stats.deleted++;
      logger.debug({ id: row.id, filePath: row.filePath }, 'Reconciler: deleted stale note');
    }
  }

  logger.info(stats, 'Storage reconciliation complete');
  return stats;
}

/**
 * Coerce an unknown YAML value to an ISO-8601 string.
 * gray-matter / js-yaml parses unquoted timestamps (e.g. `2026-04-02T15:22:09.803Z`)
 * into native Date objects. SQLite cannot bind Date objects, so we must convert them.
 * Falls back to `now` when the value is absent or unparseable (invalid Date/string).
 */
function toIsoString(value: unknown, fallback: string): string {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isNaN(timestamp) ? fallback : value.toISOString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const timestamp = Date.parse(trimmed);
    return Number.isNaN(timestamp) ? fallback : new Date(timestamp).toISOString();
  }
  return fallback;
}

/**
 * Coerce an unknown YAML value to a string array.
 * YAML sequences (e.g. `tags:\n  - AI`) are parsed as JS arrays, which is correct.
 * If somehow a plain string arrives, split on commas as a best-effort.
 */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (v == null ? '' : (typeof v === 'string' ? v : String(v)).trim()))
      .filter((v) => v !== '');
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v !== '');
  }
  return [];
}

/**
 * Coerce an unknown YAML value to a string, returning undefined when absent.
 * Date objects are converted to their ISO representation.
 * YAML block scalars (>-, |) are already resolved to plain strings by gray-matter.
 * Non-string, non-Date, non-null values (e.g. numbers, booleans) are intentionally
 * dropped (return undefined) — the fields this is used for (gist, author, source_url)
 * are always strings in practice.
 */
function toStringOrUndefined(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  return undefined;
}

export function buildMetadata(data: Record<string, unknown>): NoteMetadata {
  const now = new Date().toISOString();
  const meta: NoteMetadata = {
    id: data['id'] as string,
    type: data['type'] as NoteMetadata['type'],
    title: typeof data['title'] === 'string' ? data['title'] : String(data['title'] ?? ''),
    created: toIsoString(data['created'], now),
    updated: toIsoString(data['updated'], now),
    tags: toStringArray(data['tags']),
    links: toStringArray(data['links']),
    category: typeof data['category'] === 'string' ? data['category'] : '',
  };
  const sourceUrl = toStringOrUndefined(data['source_url']);
  if (sourceUrl) meta.sourceUrl = sourceUrl;
  const author = toStringOrUndefined(data['author']);
  if (author) meta.author = author;
  const gist = toStringOrUndefined(data['gist']);
  if (gist) meta.gist = gist;
  if (data['status']) meta.status = data['status'] as ContentStatus;
  if (data['inputSource']) meta.inputSource = data['inputSource'] as InputSource;
  return meta;
}

async function upsertVector(
  id: string,
  meta: NoteMetadata,
  content: string,
  vectorDb: VectorStorage,
  generateEmbedding: (text: string) => Promise<number[]>,
  logger: Logger,
): Promise<void> {
  const embedText = `${meta.title}\n\n${content}`;
  try {
    const vector = await generateEmbedding(embedText);
    await vectorDb.upsert({ id, text: embedText, vector, type: meta.type, title: meta.title });
  } catch (err) {
    logger.warn({ err, id }, 'Reconciler: embedding failed (non-fatal)');
  }
}
