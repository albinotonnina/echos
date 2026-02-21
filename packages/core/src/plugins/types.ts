import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { Logger } from 'pino';
import type { SqliteStorage } from '../storage/sqlite.js';
import type { MarkdownStorage } from '../storage/markdown.js';
import type { VectorStorage } from '../storage/vectordb.js';
import type { AgentDeps } from '../agent/index.js';
import type { NotificationService } from '@echos/shared';

/**
 * Dependencies provided by core to plugins.
 * Plugins use these to interact with storage, embeddings, and logging.
 */
export interface PluginContext {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
  vectorDb: VectorStorage;
  generateEmbedding: (text: string) => Promise<number[]>;
  logger: Logger;
  getAgentDeps: () => AgentDeps;
  getNotificationService: () => NotificationService;
  config: Record<string, unknown> & {
    openaiApiKey?: string;
    anthropicApiKey?: string;
    knowledgeDir?: string;
    defaultModel?: string;
  };
}

/**
 * A scheduled job processor registered by a plugin.
 */
export interface ScheduledJob {
  /** Unique job type identifier (e.g. 'digest', 'newsletter') */
  type: string;

  /** Human-readable description */
  description: string;

  /**
   * The processor function invoked by the scheduler.
   * Receives the BullMQ job and optional per-schedule config from the DB.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processor: (job: any, config?: Record<string, unknown>) => Promise<void>;
}

/**
 * Result returned by a plugin's setup method.
 */
export interface PluginSetupResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: AgentTool<any>[];
  jobs?: ScheduledJob[];
}

/**
 * A plugin registers agent tools and optionally scheduled jobs.
 */
export interface EchosPlugin {
  /** Unique plugin identifier (e.g. 'youtube', 'article') */
  name: string;

  /** Human-readable description */
  description: string;

  /** Semantic version */
  version: string;

  /**
   * Called once when the plugin is loaded.
   * Returns agent tools and optionally scheduled job processors.
   */
  setup(context: PluginContext): PluginSetupResult | Promise<PluginSetupResult>;

  /**
   * Optional teardown for cleanup.
   */
  teardown?(): void | Promise<void>;
}
