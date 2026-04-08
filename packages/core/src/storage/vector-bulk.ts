/**
 * Bulk vector loading utilities for benchmarks and testing.
 *
 * Unlike VectorStorage.upsert() (which does one LanceDB write per document),
 * this creates the table in a single batch write — suitable for loading
 * large synthetic corpora where no prior data exists.
 */

import * as lancedb from '@lancedb/lancedb';
import { mkdirSync } from 'node:fs';
import type { Logger } from 'pino';
import type { VectorStorage, VectorDocument } from './vectordb.js';
import { createVectorStorage } from './vectordb.js';

const TABLE_NAME = 'documents';

/**
 * Creates a VectorStorage backed by a fresh LanceDB table populated in a
 * single batch write.  Falls back to the standard one-at-a-time path for
 * empty arrays.
 *
 * This is intentionally a write-once helper: it is only safe to call when
 * the target `dbPath` does not already contain a `documents` table (i.e. a
 * fresh benchmark temp directory).
 */
export async function createVectorStorageBulk(
  dbPath: string,
  docs: VectorDocument[],
  logger: Logger,
  dimensions: number,
): Promise<VectorStorage> {
  if (docs.length === 0) {
    return createVectorStorage(dbPath, logger, { dimensions });
  }

  mkdirSync(dbPath, { recursive: true });
  const db = await lancedb.connect(dbPath);

  // Single-batch create — much faster than N individual table.add() calls
  const tableNames = await db.tableNames();
  if (!tableNames.includes(TABLE_NAME)) {
    const rows = docs.map((d) => ({ ...d } as Record<string, unknown>));
    await db.createTable(TABLE_NAME, rows);
    logger.debug({ dbPath, count: docs.length }, 'LanceDB bulk table created');
  }

  // Return a standard VectorStorage so callers can use the search API normally
  return createVectorStorage(dbPath, logger, { dimensions });
}
