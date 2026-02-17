import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import type { JobData } from '../queue.js';

export interface ProcessorDeps {
  contentProcessor: (job: Job<JobData>) => Promise<void>;
  digestProcessor: (job: Job<JobData>) => Promise<void>;
  reminderProcessor: (job: Job<JobData>) => Promise<void>;
  logger: Logger;
}

export function createJobRouter(deps: ProcessorDeps) {
  return async (job: Job<JobData>): Promise<void> => {
    const { type } = job.data;

    switch (type) {
      case 'process_article':
      case 'process_youtube':
        await deps.contentProcessor(job);
        break;

      case 'digest':
        await deps.digestProcessor(job);
        break;

      case 'reminder_check':
        await deps.reminderProcessor(job);
        break;

      case 'newsletter':
      case 'trending':
        deps.logger.warn({ type }, 'Job type not yet implemented');
        break;

      default:
        deps.logger.warn({ type }, 'Unknown job type');
    }
  };
}
