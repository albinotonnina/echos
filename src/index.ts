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
  createExportCleanupProcessor,
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
import twitterPlugin from '@echos/plugin-twitter';

const logger = createLogger('echos');

/**
 * Check if Redis is reachable by sending a PING command via raw TCP (RESP protocol).
 */
interface RedisCheckResult {
  ok: boolean;
  error?: string;
}

async function checkRedisConnection(redisUrl: string, log: typeof logger): Promise<RedisCheckResult> {
  try {
    const url = new URL(redisUrl);
    const host = url.hostname || '127.0.0.1';
    const port = parseInt(url.port || '6379', 10);
    const password = url.password ? decodeURIComponent(url.password) : undefined;
    const isTls = url.protocol === 'rediss:';

    const { createConnection } = await import('node:net');
    const tls = await import('node:tls');

    return new Promise((resolve) => {
      let buffer = '';
      let settled = false;
      let authPending = !!password;

      const socket = isTls
        ? tls.connect({ host, port })
        : createConnection({ host, port });

      function sendPing() {
        if (password && authPending) {
          const encodedLen = Buffer.byteLength(password, 'utf8');
          socket.write(`*2\r\n$4\r\nAUTH\r\n$${encodedLen}\r\n${password}\r\n`);
        } else {
          socket.write('*1\r\n$4\r\nPING\r\n');
        }
      }

      socket.once('connect', sendPing);
      socket.once('secureConnect', sendPing);

      socket.setTimeout(3000);

      socket.on('data', (data: Buffer) => {
        if (settled) return;

        buffer += data.toString('utf8');
        const terminatorIndex = buffer.indexOf('\r\n');
        if (terminatorIndex === -1) return;

        const line = buffer.slice(0, terminatorIndex).trim();

        if (authPending && line === '+OK') {
          authPending = false;
          buffer = buffer.slice(terminatorIndex + 2);
          socket.write('*1\r\n$4\r\nPING\r\n');
          return;
        }

        settled = true;
        socket.end();

        if (line === '+PONG') {
          log.debug({ host, port }, 'Redis pre-flight check passed');
          resolve({ ok: true });
        } else {
          const errMsg = line.startsWith('-') ? line.slice(1).trim() : `unexpected response: ${line}`;
          log.debug({ host, port, response: line }, 'Redis responded unexpectedly');
          resolve({ ok: false, error: errMsg });
        }
      });

      socket.on('error', (err: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        log.debug({ host, port, error: err.message }, 'Redis pre-flight check failed');
        resolve({ ok: false, error: err.message });
      });

      socket.on('timeout', () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        log.debug({ host, port }, 'Redis pre-flight check timed out');
        resolve({ ok: false, error: 'connection timed out' });
      });

      socket.on('end', () => {
        if (settled) return;
        settled = true;
        log.debug({ host, port }, 'Redis connection ended before response');
        resolve({ ok: false, error: 'connection closed unexpectedly' });
      });
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info('Starting EchOS...');

  // Derive exportsDir alongside the other data directories
  const exportsDir = join(config.dbPath, '..', 'exports');

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
  pluginRegistry.register(twitterPlugin);

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
      ...(config.llmApiKey ? { llmApiKey: config.llmApiKey } : {}),
      ...(config.llmBaseUrl ? { llmBaseUrl: config.llmBaseUrl } : {}),
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
    ...(config.anthropicApiKey !== undefined ? { anthropicApiKey: config.anthropicApiKey } : {}),
    ...(config.llmApiKey !== undefined ? { llmApiKey: config.llmApiKey } : {}),
    ...(config.llmBaseUrl !== undefined ? { llmBaseUrl: config.llmBaseUrl } : {}),
    modelId: config.defaultModel,
    modelPresets: {
      ...(config.modelBalanced ? { balanced: config.modelBalanced } : {}),
      ...(config.modelDeep ? { deep: config.modelDeep } : {}),
    },
    thinkingLevel: config.thinkingLevel,
    logLlmPayloads: config.logLlmPayloads,
    cacheRetention: config.cacheRetention,
    logger,
    pluginTools: [...pluginRegistry.getTools(), manageScheduleTool],
    exportsDir,
  };

  const interfaces: InterfaceAdapter[] = [];
  let telegramAdapter: TelegramAdapter | undefined;

  if (config.enableTelegram) {
    telegramAdapter = createTelegramAdapter({ config, agentDeps, logger });
    interfaces.push(telegramAdapter);
  }

  let webAdapterSyncSchedule: ((id: string) => Promise<void>) | undefined = undefined;
  let webAdapterDeleteSchedule: ((id: string) => Promise<boolean>) | undefined = undefined;

  // Scheduler setup (requires Redis)
  let queueService: QueueService | undefined;
  let worker: ReturnType<typeof createWorker> | undefined;

  logger.info('Initializing scheduler...');

  // Pre-flight: verify Redis is reachable before attempting BullMQ setup
  const redisResult = await checkRedisConnection(config.redisUrl, logger);
  if (!redisResult.ok) {
    logger.fatal(
      { redisError: redisResult.error },
      'Redis is not reachable. EchOS requires Redis for background job processing.\n' +
        '  Install and start Redis, then restart EchOS:\n' +
        '  macOS:  brew install redis && brew services start redis\n' +
        '  Linux:  sudo apt install redis-server && sudo systemctl start redis-server\n' +
        '  Docker: docker run -d -p 6379:6379 redis:7-alpine\n' +
        '  Manage: pnpm redis:start',
    );
    process.exit(1);
  }

  // Get notification service from Telegram or use log-only fallback
  notificationService = telegramAdapter?.notificationService ?? {
    async sendMessage(userId: number, text: string): Promise<void> {
      logger.info({ userId, text }, 'Notification (no delivery channel)');
    },
    async broadcast(text: string): Promise<void> {
      logger.info({ text }, 'Broadcast notification (no delivery channel)');
    },
  };

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

  const exportCleanupProcessor = createExportCleanupProcessor({ exportsDir, logger });

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
    exportCleanupProcessor,
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

  if (config.enableWeb) {
    const webOptions: import('@echos/web').WebAdapterOptions = {
      config,
      agentDeps,
      logger,
      exportsDir,
    };
    if (webAdapterSyncSchedule) webOptions.syncSchedule = webAdapterSyncSchedule;
    if (webAdapterDeleteSchedule) webOptions.deleteSchedule = webAdapterDeleteSchedule;

    interfaces.push(createWebAdapter(webOptions));
  }

  for (const iface of interfaces) {
    await iface.start();
  }

  logger.info(
    { interfaceCount: interfaces.length },
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
