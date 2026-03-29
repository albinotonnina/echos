/**
 * Agent dependencies and plugin config assembly.
 */

import { join } from 'node:path';
import type { Logger } from 'pino';
import type { Config } from '@echos/shared';
import type { AgentDeps, PluginRegistry } from '@echos/core';
import type { StorageResult } from './storage-init.js';
import type { createManageScheduleTool } from '@echos/scheduler';

export function buildPluginConfig(config: Config): Record<string, unknown> {
  return {
    ...(config.openaiApiKey ? { openaiApiKey: config.openaiApiKey } : {}),
    ...(config.whisperLanguage ? { whisperLanguage: config.whisperLanguage } : {}),
    ...(config.anthropicApiKey ? { anthropicApiKey: config.anthropicApiKey } : {}),
    ...(config.llmApiKey ? { llmApiKey: config.llmApiKey } : {}),
    ...(config.llmBaseUrl ? { llmBaseUrl: config.llmBaseUrl } : {}),
    ...(config.webshareProxyUsername ? { webshareProxyUsername: config.webshareProxyUsername } : {}),
    ...(config.webshareProxyPassword ? { webshareProxyPassword: config.webshareProxyPassword } : {}),
    knowledgeDir: config.knowledgeDir,
    defaultModel: config.defaultModel,
    dbPath: config.dbPath,
  };
}

export function buildAgentDeps(
  config: Config,
  storage: StorageResult,
  pluginRegistry: PluginRegistry,
  manageScheduleTool: ReturnType<typeof createManageScheduleTool>,
  logger: Logger,
): AgentDeps {
  return {
    sqlite: storage.sqlite,
    markdown: storage.markdown,
    vectorDb: storage.vectorDb,
    search: storage.search,
    generateEmbedding: storage.generateEmbedding,
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
    exportsDir: join(config.dbPath, '..', 'exports'),
    backupConfig: {
      knowledgeDir: config.knowledgeDir,
      dbFilePath: join(config.dbPath, 'echos.db'),
      vectorsDir: join(config.dbPath, 'vectors'),
      backupDir: config.backupDir,
    },
    backupRetentionCount: config.backupRetentionCount,
    knowledgeDir: config.knowledgeDir,
    dbPath: config.dbPath,
  };
}
