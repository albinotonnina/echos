import { readFileSync } from 'node:fs';
import chokidar from 'chokidar';
import matter from 'gray-matter';
import type { Logger } from 'pino';
import type { SqliteStorage } from './sqlite.js';
import type { VectorStorage } from './vectordb.js';
import type { MarkdownStorage } from './markdown.js';
import { computeContentHash } from './reconciler.js';
import type { NoteMetadata } from '@echos/shared';

export interface WatcherOptions {
  baseDir: string;
  sqlite: SqliteStorage;
  vectorDb: VectorStorage;
  markdown: MarkdownStorage;
  generateEmbedding: (text: string) => Promise<number[]>;
  logger: Logger;
}

export interface FileWatcher {
  stop(): Promise<void>;
}

const DEBOUNCE_MS = 500;

export function createFileWatcher(opts: WatcherOptions): FileWatcher {
  const { baseDir, sqlite, vectorDb, markdown, generateEmbedding, logger } = opts;

  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function schedule(filePath: string, fn: () => Promise<void>): void {
    const existing = debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      filePath,
      setTimeout(() => {
        debounceTimers.delete(filePath);
        fn().catch((err) => logger.error({ err, filePath }, 'File watcher: handler error'));
      }, DEBOUNCE_MS),
    );
  }

  async function handleUpsert(filePath: string): Promise<void> {
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch {
      logger.warn({ filePath }, 'File watcher: could not read file');
      return;
    }

    let data: Record<string, unknown>;
    let content: string;
    try {
      const parsed = matter(raw);
      data = parsed.data;
      content = parsed.content.trim();
    } catch {
      logger.warn({ filePath }, 'File watcher: could not parse frontmatter');
      return;
    }

    const id = data['id'] as string | undefined;
    if (!id) {
      logger.warn({ filePath }, 'File watcher: file missing id in frontmatter');
      return;
    }

    const contentHash = computeContentHash(content);
    const existing = sqlite.getNote(id);

    const meta = buildMetadata(data);
    const contentChanged = !existing || existing.contentHash !== contentHash;

    sqlite.upsertNote(meta, content, filePath, contentHash);
    markdown.registerFile(id, filePath);

    if (contentChanged) {
      const embedText = `${meta.title}\n\n${content}`;
      try {
        const vector = await generateEmbedding(embedText);
        await vectorDb.upsert({ id, text: embedText, vector, type: meta.type, title: meta.title });
      } catch (err) {
        logger.warn({ err, id }, 'File watcher: embedding failed (non-fatal)');
      }
      logger.debug({ id, filePath }, 'File watcher: upserted (content changed)');
    } else {
      logger.debug({ id, filePath }, 'File watcher: metadata-only change, skipped re-embedding');
    }
  }

  async function handleUnlink(filePath: string): Promise<void> {
    const row = sqlite.getNoteByFilePath(filePath);
    if (!row) {
      logger.debug({ filePath }, 'File watcher: unlinked file not in index, ignoring');
      return;
    }
    sqlite.deleteNote(row.id);
    await vectorDb.remove(row.id);
    markdown.unregisterFile(filePath);
    logger.debug({ id: row.id, filePath }, 'File watcher: removed deleted note');
  }

  const watcher = chokidar.watch(`${baseDir}/**/*.md`, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  watcher.on('add', (filePath) => {
    schedule(filePath, () => handleUpsert(filePath));
  });

  watcher.on('change', (filePath) => {
    schedule(filePath, () => handleUpsert(filePath));
  });

  watcher.on('unlink', (filePath) => {
    schedule(filePath, () => handleUnlink(filePath));
  });

  watcher.on('error', (err) => {
    logger.error({ err }, 'File watcher error');
  });

  logger.info({ baseDir }, 'File watcher started');

  return {
    async stop(): Promise<void> {
      for (const timer of debounceTimers.values()) clearTimeout(timer);
      debounceTimers.clear();
      await watcher.close();
      logger.info('File watcher stopped');
    },
  };
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
  return meta;
}
