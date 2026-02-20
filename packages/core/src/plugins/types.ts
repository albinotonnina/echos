import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { Logger } from 'pino';
import type { SqliteStorage } from '../storage/sqlite.js';
import type { MarkdownStorage } from '../storage/markdown.js';
import type { VectorStorage } from '../storage/vectordb.js';

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
  config: Record<string, unknown> & {
    openaiApiKey?: string;
    anthropicApiKey?: string;
    knowledgeDir?: string;
    defaultModel?: string;
  };
}

/**
 * A plugin registers one or more agent tools.
 */
export interface EchosPlugin {
  /** Unique plugin identifier (e.g. 'youtube', 'article') */
  name: string;

  /** Human-readable description */
  description: string;

  /** Semantic version */
  version: string;

  /**
   * Called once when the plugin is loaded. Returns agent tools to register.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setup(context: PluginContext): AgentTool<any>[] | Promise<AgentTool<any>[]>;

  /**
   * Optional teardown for cleanup.
   */
  teardown?(): void | Promise<void>;
}
