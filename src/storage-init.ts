/**
 * Storage initialization module.
 * Creates SQLite, Markdown, Vector, and Search storage, runs reconciliation, and starts the file watcher.
 */

import { join } from 'node:path';
import type { Logger } from 'pino';
import type { Config } from '@echos/shared';
import {
  createSqliteStorage,
  createMarkdownStorage,
  createVectorStorage,
  createSearchService,
  reconcileStorage,
  createFileWatcher,
  createEmbeddingFn,
  type FileWatcher,
} from '@echos/core';

export interface StorageResult {
  sqlite: ReturnType<typeof createSqliteStorage>;
  markdown: ReturnType<typeof createMarkdownStorage>;
  vectorDb: Awaited<ReturnType<typeof createVectorStorage>>;
  search: ReturnType<typeof createSearchService>;
  generateEmbedding: ReturnType<typeof createEmbeddingFn>;
  fileWatcher: FileWatcher;
}

export async function initStorage(config: Config, logger: Logger): Promise<StorageResult> {
  const sqlite = createSqliteStorage(join(config.dbPath, 'echos.db'), logger);
  const markdown = createMarkdownStorage(config.knowledgeDir, logger);
  const vectorDb = await createVectorStorage(join(config.dbPath, 'vectors'), logger, {
    dimensions: config.embeddingDimensions,
  });
  const search = createSearchService(sqlite, vectorDb, markdown, logger, {
    anthropicApiKey: config.anthropicApiKey,
  });

  const generateEmbedding = createEmbeddingFn({
    openaiApiKey: config.openaiApiKey,
    model: config.embeddingModel,
    dimensions: config.embeddingDimensions,
    logger,
  });

  await reconcileStorage({
    baseDir: config.knowledgeDir,
    sqlite,
    vectorDb,
    markdown,
    generateEmbedding,
    logger,
  });

  const fileWatcher: FileWatcher = createFileWatcher({
    baseDir: config.knowledgeDir,
    sqlite,
    vectorDb,
    markdown,
    generateEmbedding,
    logger,
  });

  return { sqlite, markdown, vectorDb, search, generateEmbedding, fileWatcher };
}
