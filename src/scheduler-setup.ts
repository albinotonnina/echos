/**
 * Scheduler setup module.
 * Creates queue, processors, workers, and schedule manager.
 */

import { join } from 'node:path';
import type { Logger } from 'pino';
import type { Config, NotificationService } from '@echos/shared';
import type { PluginRegistry } from '@echos/core';
import type { StorageResult } from './storage-init.js';
import {
  createQueue,
  createWorker,
  ScheduleManager,
  createContentProcessor,
  createReminderCheckProcessor,
  createExportCleanupProcessor,
  createTrashPurgeProcessor,
  createBackupProcessor,
  createUpdateCheckProcessor,
  createJobRouter,
  createManageScheduleTool,
  type QueueService,
} from '@echos/scheduler';

export interface SchedulerResult {
  queueService: QueueService;
  worker: ReturnType<typeof createWorker>;
  scheduleManager: ScheduleManager;
  manageScheduleTool: ReturnType<typeof createManageScheduleTool>;
  syncSchedule: (id: string) => Promise<void>;
  deleteSchedule: (id: string) => Promise<boolean>;
}

export async function setupScheduler(
  config: Config,
  storage: Pick<StorageResult, 'sqlite' | 'markdown' | 'vectorDb' | 'generateEmbedding'>,
  pluginRegistry: PluginRegistry,
  notificationService: NotificationService,
  logger: Logger,
): Promise<SchedulerResult> {
  const exportsDir = join(config.dbPath, '..', 'exports');
  const backupConfig = {
    knowledgeDir: config.knowledgeDir,
    dbFilePath: join(config.dbPath, 'echos.db'),
    vectorsDir: join(config.dbPath, 'vectors'),
    backupDir: config.backupDir,
  };

  const manageScheduleTool = createManageScheduleTool({ sqlite: storage.sqlite });
  const queueService = createQueue({ redisUrl: config.redisUrl, logger });

  const contentProcessor = createContentProcessor({
    sqlite: storage.sqlite,
    markdown: storage.markdown,
    vectorDb: storage.vectorDb,
    generateEmbedding: storage.generateEmbedding,
    logger,
    ...(config.openaiApiKey ? { openaiApiKey: config.openaiApiKey } : {}),
    ...(config.whisperLanguage ? { whisperLanguage: config.whisperLanguage } : {}),
  });

  const reminderProcessor = createReminderCheckProcessor({
    sqlite: storage.sqlite,
    notificationService,
    logger,
  });

  const exportCleanupProcessor = createExportCleanupProcessor({ exportsDir, logger });
  const trashPurgeProcessor = createTrashPurgeProcessor({
    sqlite: storage.sqlite,
    markdown: storage.markdown,
    vectorDb: storage.vectorDb,
    logger,
  });
  const backupProcessor = createBackupProcessor({
    backupConfig,
    retentionCount: config.backupRetentionCount,
    logger,
  });
  const updateCheckProcessor = createUpdateCheckProcessor({
    notificationService,
    logger,
    disableUpdateCheck: config.disableUpdateCheck,
  });

  const scheduleManager = new ScheduleManager(
    queueService.queue,
    storage.sqlite,
    pluginRegistry.getJobs(),
    logger,
    { enabled: config.backupEnabled, cron: config.backupCron },
  );
  manageScheduleTool.setScheduleManager(scheduleManager);

  const jobRouter = createJobRouter({
    scheduleManager,
    contentProcessor,
    reminderProcessor,
    exportCleanupProcessor,
    trashPurgeProcessor,
    backupProcessor,
    updateCheckProcessor,
    logger,
  });

  const worker = createWorker({
    redisUrl: config.redisUrl,
    logger,
    processor: jobRouter,
    concurrency: 2,
  });

  await scheduleManager.syncAll();
  logger.info('Scheduler initialized');

  return {
    queueService,
    worker,
    scheduleManager,
    manageScheduleTool,
    syncSchedule: (id: string) => scheduleManager.syncSchedule(id),
    deleteSchedule: (id: string) => scheduleManager.deleteSchedule(id),
  };
}
