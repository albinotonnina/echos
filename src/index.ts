#!/usr/bin/env node

/**
 * EchOS main entry point.
 * Initializes storage, creates agent deps, and starts enabled interfaces.
 */

import { join } from 'node:path';
import {
  loadConfig,
  createLogger,
  type InterfaceAdapter,
  type NotificationService,
} from '@echos/shared';
import {
  createSqliteStorage,
  createMarkdownStorage,
  createVectorStorage,
  createSearchService,
  reconcileStorage,
  createFileWatcher,
  createEmbeddingFn,
  PluginRegistry,
  type AgentDeps,
  type FileWatcher,
} from '@echos/core';
import { createTelegramAdapter, type TelegramAdapter } from '@echos/telegram';
import { createWebAdapter } from '@echos/web';
import {
  createQueue,
  createWorker,
  ScheduleManager,
  createContentProcessor,
  createReminderCheckProcessor,
  createJobRouter,
  createManageScheduleTool,
  type QueueService,
} from '@echos/scheduler';

// Plugins
import youtubePlugin from '@echos/plugin-youtube';
import articlePlugin from '@echos/plugin-article';
import contentCreationPlugin from '@echos/plugin-content-creation';
import imagePlugin from '@echos/plugin-image';
import digestPlugin from '@echos/plugin-digest';

const logger = createLogger('echos');

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info('Starting EchOS...');

  // Initialize storage
  const sqlite = createSqliteStorage(join(config.dbPath, 'echos.db'), logger);
  const markdown = createMarkdownStorage(config.knowledgeDir, logger);
  const vectorDb = await createVectorStorage(join(config.dbPath, 'vectors'), logger, {
    dimensions: config.embeddingDimensions,
  });
  const search = createSearchService(sqlite, vectorDb, markdown, logger);

  const generateEmbedding = createEmbeddingFn({
    openaiApiKey: config.openaiApiKey,
    model: config.embeddingModel,
    dimensions: config.embeddingDimensions,
    logger,
  });

  // Reconcile markdown files with SQLite and LanceDB on startup
  await reconcileStorage({
    baseDir: config.knowledgeDir,
    sqlite,
    vectorDb,
    markdown,
    generateEmbedding,
    logger,
  });

  // Watch for live changes to markdown files
  const fileWatcher: FileWatcher = createFileWatcher({
    baseDir: config.knowledgeDir,
    sqlite,
    vectorDb,
    markdown,
    generateEmbedding,
    logger,
  });

  // Initialize plugins
  const pluginRegistry = new PluginRegistry(logger);
  pluginRegistry.register(articlePlugin);
  pluginRegistry.register(youtubePlugin);
  pluginRegistry.register(contentCreationPlugin);
  pluginRegistry.register(imagePlugin);
  pluginRegistry.register(digestPlugin);

  let agentDeps: AgentDeps;
  let notificationService: import('@echos/shared').NotificationService;

  await pluginRegistry.setupAll({
    sqlite,
    markdown,
    vectorDb,
    generateEmbedding,
    logger,
    getAgentDeps: () => agentDeps,
    getNotificationService: () => notificationService,
    config: {
      ...(config.openaiApiKey ? { openaiApiKey: config.openaiApiKey } : {}),
      ...(config.anthropicApiKey ? { anthropicApiKey: config.anthropicApiKey } : {}),
      ...(config.webshareProxyUsername ? { webshareProxyUsername: config.webshareProxyUsername } : {}),
      ...(config.webshareProxyPassword ? { webshareProxyPassword: config.webshareProxyPassword } : {}),
      knowledgeDir: config.knowledgeDir,
      defaultModel: config.defaultModel,
    },
  });

  const manageScheduleTool = createManageScheduleTool({ sqlite });

  agentDeps = {
    sqlite,
    markdown,
    vectorDb,
    search,
    generateEmbedding,
    anthropicApiKey: config.anthropicApiKey,
    modelId: config.defaultModel,
    modelPresets: {
      ...(config.modelBalanced ? { balanced: config.modelBalanced } : {}),
      ...(config.modelDeep ? { deep: config.modelDeep } : {}),
    },
    thinkingLevel: config.thinkingLevel,
    logLlmPayloads: config.logLlmPayloads,
    logger,
    pluginTools: [...pluginRegistry.getTools(), manageScheduleTool],
  };

  const interfaces: InterfaceAdapter[] = [];
  let telegramAdapter: TelegramAdapter | undefined;

  if (config.enableTelegram) {
    telegramAdapter = createTelegramAdapter({ config, agentDeps, logger });
    interfaces.push(telegramAdapter);
  }

  let webAdapterSyncSchedule: ((id: string) => Promise<void>) | undefined = undefined;
  let webAdapterDeleteSchedule: ((id: string) => Promise<boolean>) | undefined = undefined;

  // Scheduler setup (requires Redis, opt-in via ENABLE_SCHEDULER=true)
  let queueService: QueueService | undefined;
  let worker: ReturnType<typeof createWorker> | undefined;

  if (config.enableScheduler) {
    logger.info('Initializing scheduler...');

    // Get notification service from Telegram or use log-only fallback
    notificationService = telegramAdapter?.notificationService ?? {
      async sendMessage(userId: number, text: string): Promise<void> {
        logger.info({ userId, text }, 'Notification (no delivery channel)');
      },
      async broadcast(text: string): Promise<void> {
        logger.info({ text }, 'Broadcast notification (no delivery channel)');
      },
    };

    try {
      queueService = createQueue({ redisUrl: config.redisUrl, logger });

      const contentProcessor = createContentProcessor({
        sqlite,
        markdown,
        vectorDb,
        generateEmbedding,
        logger,
        ...(config.openaiApiKey ? { openaiApiKey: config.openaiApiKey } : {}),
      });

      const reminderProcessor = createReminderCheckProcessor({
        sqlite,
        notificationService,
        logger,
      });

      const scheduleManager = new ScheduleManager(
        queueService.queue,
        sqlite,
        pluginRegistry.getJobs(),
        logger,
      );
      manageScheduleTool.setScheduleManager(scheduleManager);

      webAdapterSyncSchedule = (id: string) => scheduleManager.syncSchedule(id);
      webAdapterDeleteSchedule = (id: string) => scheduleManager.deleteSchedule(id);

      const jobRouter = createJobRouter({
        scheduleManager,
        contentProcessor,
        reminderProcessor,
        logger,
      });

      worker = createWorker({
        redisUrl: config.redisUrl,
        logger,
        processor: jobRouter,
        concurrency: 2,
      });

      await scheduleManager.syncAll();
      logger.info('Scheduler initialized');
    } catch (err) {
      logger.warn(
        { err, redisUrl: config.redisUrl },
        'Scheduler unavailable: Redis connection failed. Running without background jobs.',
      );
      queueService = undefined;
      worker = undefined;
    }
  }

  if (config.enableWeb) {
    const webOptions: import('@echos/web').WebAdapterOptions = {
      config,
      agentDeps,
      logger,
    };
    if (webAdapterSyncSchedule) webOptions.syncSchedule = webAdapterSyncSchedule;
    if (webAdapterDeleteSchedule) webOptions.deleteSchedule = webAdapterDeleteSchedule;

    interfaces.push(createWebAdapter(webOptions));
  }

  for (const iface of interfaces) {
    await iface.start();
  }

  logger.info(
    { interfaceCount: interfaces.length, schedulerEnabled: config.enableScheduler },
    'EchOS started',
  );

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down...');

    // Close scheduler first (stop accepting new jobs)
    if (worker) {
      await worker.close();
      logger.info('Worker closed');
    }
    if (queueService) {
      await queueService.close();
    }

    await fileWatcher.stop();

    for (const iface of interfaces) {
      await iface.stop();
    }
    await pluginRegistry.teardownAll();
    sqlite.close();
    vectorDb.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error');
  process.exit(1);
});
