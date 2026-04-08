#!/usr/bin/env node
/**
 * EchOS daemon entry point — thin orchestrator that delegates to focused modules.
 */
import { join } from 'node:path';
import { loadConfig, createLogger, type InterfaceAdapter } from '@echos/shared';
import { PluginRegistry, type AgentDeps, createMcpServer } from '@echos/core';
import { createTelegramAdapter, type TelegramAdapter } from '@echos/telegram';
import { createWebAdapter } from '@echos/web';
import { createManageScheduleTool } from '@echos/scheduler';
import { checkRedisConnection } from './redis-check.js';
import { initStorage } from './storage-init.js';
import { loadPlugins } from './plugin-loader.js';
import { setupScheduler } from './scheduler-setup.js';
import { createShutdownHandler } from './shutdown.js';
import { buildPluginConfig, buildAgentDeps } from './agent-deps.js';

const logger = createLogger('echos');

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info('Starting EchOS...');

  const storage = await initStorage(config, logger);

  const pluginRegistry = new PluginRegistry(logger);
  for (const plugin of await loadPlugins(logger)) pluginRegistry.register(plugin);

  let notificationService: import('@echos/shared').NotificationService;
  await pluginRegistry.setupAll({
    sqlite: storage.sqlite, markdown: storage.markdown, vectorDb: storage.vectorDb,
    generateEmbedding: storage.generateEmbedding, logger,
    getAgentDeps: () => agentDeps, getNotificationService: () => notificationService,
    config: buildPluginConfig(config),
  });

  const redisResult = await checkRedisConnection(config.redisUrl, logger);
  if (!redisResult.ok) {
    logger.fatal({ redisError: redisResult.error },
      'Redis is not reachable — install and start Redis, then restart EchOS (pnpm redis:start)');
    process.exit(1);
  }

  const manageScheduleTool = createManageScheduleTool({ sqlite: storage.sqlite });
  const agentDeps: AgentDeps = buildAgentDeps(config, storage, pluginRegistry, manageScheduleTool, logger);
  const interfaces: InterfaceAdapter[] = [];
  let telegramAdapter: TelegramAdapter | undefined;
  if (config.enableTelegram) {
    telegramAdapter = createTelegramAdapter({ config, agentDeps, logger });
    interfaces.push(telegramAdapter);
  }

  notificationService = telegramAdapter?.notificationService ?? {
    sendMessage: async (userId: number, text: string) => { logger.info({ userId, text }, 'Notification (no channel)'); },
    broadcast: async (text: string) => { logger.info({ text }, 'Broadcast (no channel)'); },
  };

  const scheduler = await setupScheduler(
    config, storage, pluginRegistry, notificationService, manageScheduleTool, logger);

  if (config.enableWeb) {
    interfaces.push(createWebAdapter({
      config, agentDeps, logger, exportsDir: join(config.dbPath, '..', 'exports'),
      syncSchedule: scheduler.syncSchedule, deleteSchedule: scheduler.deleteSchedule,
    }));
  }

  if (config.enableMcp) {
    interfaces.push(createMcpServer(
      {
        sqlite: storage.sqlite,
        markdown: storage.markdown,
        vectorDb: storage.vectorDb,
        search: storage.search,
        generateEmbedding: storage.generateEmbedding,
        knowledgeDir: config.knowledgeDir,
        dbPath: config.dbPath,
        logger,
      },
      { port: config.mcpPort, apiKey: config.mcpApiKey },
    ));
  }

  for (const iface of interfaces) await iface.start();
  logger.info({ interfaceCount: interfaces.length }, 'EchOS started');

  const shutdown = createShutdownHandler({
    worker: scheduler.worker, queueService: scheduler.queueService,
    fileWatcher: storage.fileWatcher, interfaces, pluginRegistry,
    sqlite: storage.sqlite, vectorDb: storage.vectorDb, logger,
  });
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => { logger.fatal({ err }, 'Fatal error'); process.exit(1); });
