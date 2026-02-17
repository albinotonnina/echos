import { Queue, Worker, type Job } from 'bullmq';
import type { Logger } from 'pino';

export interface QueueConfig {
  redisUrl: string;
  logger: Logger;
}

export type JobType = 'process_article' | 'process_youtube' | 'digest' | 'newsletter' | 'trending' | 'reminder_check';

export interface JobData {
  type: JobType;
  url?: string;
  userId?: number;
  chatId?: number;
  tags?: string[];
  category?: string;
}

export interface QueueService {
  queue: Queue;
  addJob(data: JobData): Promise<string>;
  close(): Promise<void>;
}

export function createQueue(config: QueueConfig): QueueService {
  const url = new URL(config.redisUrl);
  const connection = {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
  };

  const queue = new Queue('echos', { connection });

  config.logger.info('BullMQ queue initialized');

  return {
    queue,

    async addJob(data: JobData): Promise<string> {
      const job = await queue.add(data.type, data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      });

      config.logger.info({ jobId: job.id, type: data.type }, 'Job added');
      return job.id ?? '';
    },

    async close(): Promise<void> {
      await queue.close();
      config.logger.info('Queue closed');
    },
  };
}

export interface WorkerConfig {
  redisUrl: string;
  logger: Logger;
  processor: (job: Job<JobData>) => Promise<void>;
  concurrency?: number;
}

export function createWorker(config: WorkerConfig): Worker<JobData> {
  const url = new URL(config.redisUrl);
  const connection = {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
  };

  const worker = new Worker<JobData>(
    'echos',
    async (job: Job<JobData>) => {
      config.logger.info({ jobId: job.id, type: job.data.type }, 'Processing job');
      try {
        await config.processor(job);
        config.logger.info({ jobId: job.id }, 'Job completed');
      } catch (err) {
        config.logger.error({ err, jobId: job.id }, 'Job failed');
        throw err;
      }
    },
    {
      connection,
      concurrency: config.concurrency ?? 3,
    },
  );

  worker.on('error', (err) => {
    config.logger.error({ err }, 'Worker error');
  });

  config.logger.info({ concurrency: config.concurrency ?? 3 }, 'Worker started');
  return worker;
}
