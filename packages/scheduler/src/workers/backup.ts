import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import type { JobData } from '../queue.js';
import { createBackup, pruneBackups, type BackupConfig } from '@echos/core';

export interface BackupWorkerDeps {
  backupConfig: BackupConfig;
  retentionCount: number;
  logger: Logger;
}

/** Creates a BullMQ processor that creates a backup and prunes old ones. */
export function createBackupProcessor(deps: BackupWorkerDeps) {
  return async (_job: Job<JobData>): Promise<void> => {
    const { backupConfig, retentionCount, logger } = deps;

    logger.info({ backupDir: backupConfig.backupDir }, 'Backup job started');

    let result;
    try {
      result = await createBackup(backupConfig);
      logger.info(
        { fileName: result.fileName, sizeBytes: result.sizeBytes, noteCount: result.noteCount },
        'Backup created successfully',
      );
    } catch (err) {
      logger.error({ err }, 'Backup job failed to create backup');
      throw err;
    }

    const removed = pruneBackups(backupConfig.backupDir, retentionCount);
    if (removed > 0) {
      logger.info({ removed, retentionCount }, 'Old backups pruned');
    }
  };
}
