#!/usr/bin/env node

/**
 * EchOS main entry point.
 * Initializes storage, creates agent deps, and starts enabled interfaces.
 */

import { join } from 'node:path';
import { loadConfig, createLogger, type InterfaceAdapter } from '@echos/shared';
import {
  createSqliteStorage,
  createMarkdownStorage,
  createVectorStorage,
  createSearchService,
  PluginRegistry,
  type AgentDeps,
} from '@echos/core';
import { createTelegramAdapter } from '@echos/telegram';
import { createWebAdapter } from '@echos/web';
import { createTuiAdapter } from '@echos/tui';

// Plugins
import youtubePlugin from '@echos/plugin-youtube';
import articlePlugin from '@echos/plugin-article';

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

  // Initialize plugins
  const pluginRegistry = new PluginRegistry(logger);
  pluginRegistry.register(articlePlugin);
  pluginRegistry.register(youtubePlugin);

  await pluginRegistry.setupAll({
    sqlite,
    markdown,
    vectorDb,
    generateEmbedding,
    logger,
    config: {
      openaiApiKey: config.openaiApiKey,
    },
  });

  const agentDeps: AgentDeps = {
    sqlite,
    markdown,
    vectorDb,
    search,
    generateEmbedding,
    modelId: config.defaultModel,
    logger,
    pluginTools: pluginRegistry.getTools(),
  };

  const interfaces: InterfaceAdapter[] = [];

  if (config.enableTelegram) {
    interfaces.push(createTelegramAdapter({ config, agentDeps, logger }));
  }

  if (config.enableWeb) {
    interfaces.push(createWebAdapter({ config, agentDeps, logger }));
  }

  if (config.enableTui) {
    interfaces.push(createTuiAdapter({ agentDeps, logger }));
  }

  for (const iface of interfaces) {
    await iface.start();
  }

  logger.info({ interfaceCount: interfaces.length }, 'EchOS started');

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down...');
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
