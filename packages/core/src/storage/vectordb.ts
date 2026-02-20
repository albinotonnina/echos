import * as lancedb from '@lancedb/lancedb';
import type { Logger } from 'pino';
import { mkdirSync } from 'node:fs';

export interface VectorDocument {
  id: string;
  text: string;
  vector: number[];
  type: string;
  title: string;
}

export interface VectorSearchResult {
  id: string;
  text: string;
  type: string;
  title: string;
  score: number;
}

export interface VectorStorage {
  upsert(doc: VectorDocument): Promise<void>;
  search(vector: number[], limit?: number): Promise<VectorSearchResult[]>;
  remove(id: string): Promise<void>;
  close(): void;
}

const TABLE_NAME = 'documents';
const DEFAULT_DIMENSIONS = 1536;

export interface VectorStorageOptions {
  /** Vector dimensions. Must match the embedding function output. Default: 1536 */
  dimensions?: number;
}

export async function createVectorStorage(
  dbPath: string,
  logger: Logger,
  options?: VectorStorageOptions,
): Promise<VectorStorage> {
  const dimensions = options?.dimensions ?? DEFAULT_DIMENSIONS;
  mkdirSync(dbPath, { recursive: true });
  const db = await lancedb.connect(dbPath);

  let table: lancedb.Table;
  const tableNames = await db.tableNames();

  if (tableNames.includes(TABLE_NAME)) {
    table = await db.openTable(TABLE_NAME);
    logger.info({ dbPath, dimensions }, 'LanceDB table opened');
  } else {
    // Create with a dummy row to establish schema, then delete it
    table = await db.createTable(TABLE_NAME, [
      {
        id: '__init__',
        text: '',
        vector: new Array(dimensions).fill(0),
        type: '',
        title: '',
      },
    ]);
    await table.delete('id = "__init__"');
    logger.info({ dbPath, dimensions }, 'LanceDB table created');
  }

  return {
    async upsert(doc: VectorDocument): Promise<void> {
      // Delete existing entry if present, then add
      try {
        await table.delete(`id = "${doc.id.replace(/"/g, '\\"')}"`);
      } catch {
        // May not exist yet
      }
      await table.add([{ ...doc }]);
      logger.debug({ id: doc.id }, 'Vector upserted');
    },

    async search(vector: number[], limit: number = 10): Promise<VectorSearchResult[]> {
      const results = await table.search(vector).limit(limit).toArray();
      return results.map((row) => ({
        id: row['id'] as string,
        text: row['text'] as string,
        type: row['type'] as string,
        title: row['title'] as string,
        score: row['_distance'] != null ? 1 / (1 + (row['_distance'] as number)) : 0,
      }));
    },

    async remove(id: string): Promise<void> {
      try {
        await table.delete(`id = "${id.replace(/"/g, '\\"')}"`);
        logger.debug({ id }, 'Vector removed');
      } catch {
        // May not exist
      }
    },

    close(): void {
      logger.info('LanceDB connection closed');
    },
  };
}
