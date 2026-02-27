import { Queue, Worker, type Job } from 'bullmq';
import type { Logger } from 'pino';

interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  db?: number;
  tls?: Record<never, never>;
}

export function parseRedisUrl(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl);
  const opts: RedisConnectionOptions = {
    host: url.hostname || '127.0.0.1',
    port: parseInt(url.port || '6379', 10),
  };
  if (url.password) opts.password = decodeURIComponent(url.password);
  const db = parseInt(url.pathname.slice(1), 10);
  if (!isNaN(db) && db > 0) opts.db = db;
  if (url.protocol === 'rediss:') opts.tls = {};
  return opts;
}

export interface QueueConfig {
  redisUrl: string;
  logger: Logger;
}

export interface JobData {
  type: string;
  url?: string;
  userId?: number;
  chatId?: number;
  tags?: string[];
  category?: string;
  config?: Record<string, unknown>;
}

export interface QueueService {
  queue: Queue;
  addJob(data: JobData): Promise<string>;
  close(): Promise<void>;
}

export function createQueue(config: QueueConfig): QueueService {
  const connection = parseRedisUrl(config.redisUrl);

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
  const connection = parseRedisUrl(config.redisUrl);

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
