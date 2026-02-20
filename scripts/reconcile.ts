#!/usr/bin/env pnpm tsx

/**
 * Standalone reconciler: syncs all markdown files in the knowledge directory
 * into SQLite (metadata + FTS5) and LanceDB (vectors).
 *
 * Usage:
 *   pnpm reconcile
 *   pnpm tsx --env-file=.env scripts/reconcile.ts
 *
 * Indexes all markdown files into SQLite (FTS5) for keyword search.
 * Semantic/vector search requires the full app (pnpm start) to generate embeddings.
 */

import { join } from 'node:path';
import { loadConfig, createLogger } from '@echos/shared';
import {
  createSqliteStorage,
  createMarkdownStorage,
  createVectorStorage,
  reconcileStorage,
  createEmbeddingFn,
} from '@echos/core';

const logger = createLogger('reconcile');

async function main(): Promise<void> {
  const config = loadConfig();

  logger.info({ knowledgeDir: config.knowledgeDir, dbPath: config.dbPath }, 'Initializing storage...');

  const sqlite = createSqliteStorage(join(config.dbPath, 'echos.db'), logger);
  const markdown = createMarkdownStorage(config.knowledgeDir, logger);
  const vectorDb = await createVectorStorage(join(config.dbPath, 'vectors'), logger);

  const generateEmbedding = createEmbeddingFn({
    openaiApiKey: config.openaiApiKey,
    model: config.embeddingModel,
    logger,
  });

  const stats = await reconcileStorage({
    baseDir: config.knowledgeDir,
    sqlite,
    vectorDb,
    markdown,
    generateEmbedding,
    logger,
  });

  logger.info(stats, 'Reconciliation complete');
  console.log('\nResults:');
  console.log(`  Scanned : ${stats.scanned}`);
  console.log(`  Added   : ${stats.added}`);
  console.log(`  Updated : ${stats.updated}`);
  console.log(`  Skipped : ${stats.skipped}`);
  console.log(`  Deleted : ${stats.deleted}`);

  sqlite.close();
  vectorDb.close();
}

main().catch((err) => {
  logger.fatal({ err }, 'Reconciler failed');
  process.exit(1);
});
