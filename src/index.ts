#!/usr/bin/env node

/**
 * EchOS main entry point.
 * Initializes storage, creates agent deps, and starts enabled interfaces.
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfig, createLogger, type InterfaceAdapter, type NotificationService } from '@echos/shared';

// First-run detection: exit early with a helpful message instead of Zod errors
if (!existsSync('.env')) {
  console.error('\n  No .env file found. Run: pnpm setup\n');
  process.exit(1);
}
import {
  createSqliteStorage,
  createMarkdownStorage,
  createVectorStorage,
  createSearchService,
  reconcileStorage,
  createFileWatcher,
  PluginRegistry,
  type AgentDeps,
  type FileWatcher,
} from '@echos/core';
import { createTelegramAdapter, type TelegramAdapter } from '@echos/telegram';
import { createWebAdapter } from '@echos/web';
import { createTuiAdapter } from '@echos/tui';
import {
  createQueue,
  createWorker,
  registerScheduledJobs,
  createContentProcessor,
  createDigestProcessor,
  createReminderCheckProcessor,
  createJobRouter,
  type QueueService,
} from '@echos/scheduler';

// Plugins
import youtubePlugin from '@echos/plugin-youtube';
import articlePlugin from '@echos/plugin-article';
import contentCreationPlugin from '@echos/plugin-content-creation';

const logger = createLogger('echos');

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info('Starting EchOS...');

  // Initialize storage
  const sqlite = createSqliteStorage(join(config.dbPath, 'echos.db'), logger);
  const markdown = createMarkdownStorage(config.knowledgeDir, logger);
  const vectorDb = await createVectorStorage(join(config.dbPath, 'vectors'), logger);
  const search = createSearchService(sqlite, vectorDb, markdown, logger);

  // Stub embedding (real implementation requires OpenAI key)
  const generateEmbedding = async (_text: string): Promise<number[]> => {
    return new Array(1536).fill(0);
  };

  // Reconcile markdown files with SQLite and LanceDB on startup
  await reconcileStorage({ baseDir: config.knowledgeDir, sqlite, vectorDb, markdown, generateEmbedding, logger });

  // Watch for live changes to markdown files
  const fileWatcher: FileWatcher = createFileWatcher({ baseDir: config.knowledgeDir, sqlite, vectorDb, markdown, generateEmbedding, logger });

  // Initialize plugins
  const pluginRegistry = new PluginRegistry(logger);
  pluginRegistry.register(articlePlugin);
  pluginRegistry.register(youtubePlugin);
  pluginRegistry.register(contentCreationPlugin);

  await pluginRegistry.setupAll({
    sqlite,
    markdown,
    vectorDb,
    generateEmbedding,
    logger,
    config: {
      openaiApiKey: config.openaiApiKey,
      anthropicApiKey: config.anthropicApiKey,
      webshareProxyUsername: config.webshareProxyUsername,
      webshareProxyPassword: config.webshareProxyPassword,
    },
  });

  const agentDeps: AgentDeps = {
    sqlite,
    markdown,
    vectorDb,
    search,
    generateEmbedding,
    anthropicApiKey: config.anthropicApiKey,
    modelId: config.defaultModel,
    logger,
    pluginTools: pluginRegistry.getTools(),
  };

  const interfaces: InterfaceAdapter[] = [];
  let telegramAdapter: TelegramAdapter | undefined;

  if (config.enableTelegram) {
    telegramAdapter = createTelegramAdapter({ config, agentDeps, logger });
    interfaces.push(telegramAdapter);
  }

  if (config.enableWeb) {
    interfaces.push(createWebAdapter({ config, agentDeps, logger }));
  }

  if (config.enableTui) {
    interfaces.push(createTuiAdapter({ agentDeps, logger }));
  }

  // Scheduler setup (requires Redis, opt-in via ENABLE_SCHEDULER=true)
  let queueService: QueueService | undefined;
  let worker: ReturnType<typeof createWorker> | undefined;

  if (config.enableScheduler) {
    logger.info('Initializing scheduler...');

    // Get notification service from Telegram or use log-only fallback
    const notificationService: NotificationService = telegramAdapter?.notificationService ?? {
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
        openaiApiKey: config.openaiApiKey,
      });

      const digestProcessor = createDigestProcessor({
        agentDeps,
        notificationService,
        logger,
      });

      const reminderProcessor = createReminderCheckProcessor({
        sqlite,
        notificationService,
        logger,
      });

      const jobRouter = createJobRouter({
        contentProcessor,
        digestProcessor,
        reminderProcessor,
        logger,
      });

      worker = createWorker({
        redisUrl: config.redisUrl,
        logger,
        processor: jobRouter,
        concurrency: 2,
      });

      await registerScheduledJobs(queueService.queue, config, logger);
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

  for (const iface of interfaces) {
    await iface.start();
  }

  logger.info({ interfaceCount: interfaces.length, schedulerEnabled: config.enableScheduler }, 'EchOS started');

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
