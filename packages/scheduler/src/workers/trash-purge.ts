import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import type { JobData } from '../queue.js';
import type { SqliteStorage } from '@echos/core';
import type { MarkdownStorage, VectorStorage } from '@echos/core';

const PURGE_AFTER_DAYS = 30;

export interface TrashPurgeDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
  vectorDb: VectorStorage;
  logger: Logger;
}

/** Creates a BullMQ processor that permanently purges notes older than 30 days from trash. */
export function createTrashPurgeProcessor(deps: TrashPurgeDeps) {
  return async (_job: Job<JobData>): Promise<void> => {
    const { sqlite, markdown, vectorDb, logger } = deps;

    const deletedNotes = sqlite.listDeletedNotes();
    if (deletedNotes.length === 0) {
      logger.debug('Trash purge: no deleted notes found');
      return;
    }

    const now = Date.now();
    const purgeThreshold = PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000;
    let purged = 0;
    let errors = 0;

    for (const row of deletedNotes) {
      if (!row.deletedAt) continue;

      const deletedAt = new Date(row.deletedAt).getTime();
      if (now - deletedAt < purgeThreshold) continue;

      try {
        // Permanently remove from all stores
        markdown.purge(row.filePath);
        sqlite.purgeNote(row.id);
        await vectorDb.remove(row.id);
        purged++;
      } catch (err) {
        logger.error({ err, noteId: row.id, title: row.title }, 'Trash purge: failed to purge note');
        errors++;
      }
    }

    if (purged > 0 || errors > 0) {
      logger.info({ purged, errors, total: deletedNotes.length }, 'Trash purge complete');
    } else {
      logger.debug({ total: deletedNotes.length }, 'Trash purge: no notes old enough to purge');
    }
  };
}
