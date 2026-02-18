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

function scanMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const paths: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
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
      stats.skipped++;
    }
  }

  // Remove SQLite/LanceDB records for files that no longer exist on disk
  const allNotes = sqlite.listNotes({ limit: 100000 });
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

function buildMetadata(data: Record<string, unknown>): NoteMetadata {
  const meta: NoteMetadata = {
    id: data['id'] as string,
    type: data['type'] as NoteMetadata['type'],
    title: data['title'] as string,
    created: data['created'] as string,
    updated: data['updated'] as string,
    tags: (data['tags'] as string[]) || [],
    links: (data['links'] as string[]) || [],
    category: (data['category'] as string) || '',
  };
  if (data['source_url']) meta.sourceUrl = data['source_url'] as string;
  if (data['author']) meta.author = data['author'] as string;
  if (data['gist']) meta.gist = data['gist'] as string;
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
