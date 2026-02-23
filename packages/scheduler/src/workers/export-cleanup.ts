import { readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import type { JobData } from '../queue.js';

const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

export interface ExportCleanupDeps {
  exportsDir: string;
  logger: Logger;
}

export function createExportCleanupProcessor(deps: ExportCleanupDeps) {
  return async (_job: Job<JobData>): Promise<void> => {
    const { exportsDir, logger } = deps;

    if (!existsSync(exportsDir)) {
      logger.debug({ exportsDir }, 'Export cleanup: directory does not exist, skipping');
      return;
    }

    const now = Date.now();
    let cleaned = 0;
    let errors = 0;

    let entries: string[];
    try {
      entries = readdirSync(exportsDir);
    } catch (err) {
      logger.error({ err, exportsDir }, 'Export cleanup: failed to read exports directory');
      return;
    }

    for (const entry of entries) {
      const filePath = join(exportsDir, entry);
      try {
        const stat = statSync(filePath);
        if (stat.isFile() && now - stat.mtimeMs > MAX_AGE_MS) {
          unlinkSync(filePath);
          cleaned++;
        }
      } catch (err) {
        logger.warn({ err, filePath }, 'Export cleanup: failed to delete file');
        errors++;
      }
    }

    if (cleaned > 0 || errors > 0) {
      logger.info({ cleaned, errors, exportsDir }, 'Export cleanup complete');
    } else {
      logger.debug({ exportsDir }, 'Export cleanup: no stale files found');
    }
  };
}
