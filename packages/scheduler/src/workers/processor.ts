import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import type { JobData } from '../queue.js';
import type { ScheduleManager } from '../scheduler.js';

export interface ProcessorDeps {
  scheduleManager: ScheduleManager;
  contentProcessor: (job: Job<JobData>) => Promise<void>;
  reminderProcessor: (job: Job<JobData>) => Promise<void>;
  exportCleanupProcessor?: (job: Job<JobData>) => Promise<void>;
  trashPurgeProcessor?: (job: Job<JobData>) => Promise<void>;
  backupProcessor?: (job: Job<JobData>) => Promise<void>;
  logger: Logger;
}

export function createJobRouter(deps: ProcessorDeps) {
  return async (job: Job<JobData>): Promise<void> => {
    const { type } = job.data;

    // 1. Check explicit "built-in" event-driven and system processors
    if (type === 'process_article' || type === 'process_youtube') {
      await deps.contentProcessor(job);
      return;
    }

    if (type === 'reminder-check' || type === 'reminder_check') {
      await deps.reminderProcessor(job);
      return;
    }

    if (type === 'export_cleanup' || type === 'export-cleanup') {
      if (deps.exportCleanupProcessor) {
        await deps.exportCleanupProcessor(job);
      }
      return;
    }

    if (type === 'trash_purge' || type === 'trash-purge') {
      if (!deps.trashPurgeProcessor) {
        deps.logger.warn(
          { type, jobId: job.id },
          'Received trash_purge job but no trashPurgeProcessor is configured',
        );
        return;
      }
      await deps.trashPurgeProcessor(job);
      return;
    }

    if (type === 'backup') {
      if (!deps.backupProcessor) {
        deps.logger.warn(
          { type, jobId: job.id },
          'Received backup job but no backupProcessor is configured',
        );
        return;
      }
      await deps.backupProcessor(job);
      return;
    }

    // 2. Check plugin-registered processors via ScheduleManager
    const pluginProcessor = deps.scheduleManager.getProcessor(type);
    if (pluginProcessor) {
      await pluginProcessor(job, job.data.config);
      return;
    }

    deps.logger.warn({ type }, 'Unknown job type or no processor registered');
  };
}
