import type { AgentTool, ThinkingLevel } from '@mariozechner/pi-agent-core';
import type { Logger } from 'pino';
import type { BackupConfig } from '../backup/index.js';
import type { SqliteStorage } from '../storage/sqlite.js';
import type { MarkdownStorage } from '../storage/markdown.js';
import type { VectorStorage } from '../storage/vectordb.js';
import type { SearchService } from '../storage/search.js';
import type { SpeechToTextClient } from '../stt/index.js';

export interface AgentDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
  vectorDb: VectorStorage;
  search: SearchService;
  generateEmbedding: (text: string) => Promise<number[]>;
  anthropicApiKey?: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
  modelId?: string;
  logger: Logger;
  /** Named model presets available for /model switching */
  modelPresets?: { balanced?: string; deep?: string };
  /** Reasoning/thinking level for the LLM (set THINKING_LEVEL=off|minimal|low|medium|high|xhigh) */
  thinkingLevel?: ThinkingLevel;
  /** Log raw LLM request payloads at debug level (set LOG_LLM_PAYLOADS=true) */
  logLlmPayloads?: boolean;
  /** Prompt cache retention. Only applies to Anthropic models.
   *  'long' = 1h TTL (default), 'short' = 5min, 'none' = disabled */
  cacheRetention?: 'none' | 'short' | 'long';
  /** Additional tools registered by plugins */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pluginTools?: AgentTool<any>[];
  /** If set, core tools will not be loaded (useful for sub-agents) */
  disableCoreTools?: boolean;
  /** Directory for writing temporary export files (default: ./data/exports) */
  exportsDir?: string;
  /** Backup configuration. When provided, the manage_backups tool is registered. */
  backupConfig?: BackupConfig;
  /** Number of backups to retain when pruning (default: 7) */
  backupRetentionCount?: number;
  /** Path to the knowledge markdown files directory (used by knowledge_stats tool) */
  knowledgeDir?: string;
  /** Path to the database directory containing echos.db and vectors/ (used by knowledge_stats tool) */
  dbPath?: string;
  /** Speech-to-text client for voice transcription */
  sttClient?: SpeechToTextClient;
}

export interface AgentToolDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
  vectorDb: VectorStorage;
  search: SearchService;
  generateEmbedding: (text: string) => Promise<number[]>;
  anthropicApiKey: string | undefined;
  llmApiKey: string | undefined;
  llmBaseUrl: string | undefined;
  modelId: string | undefined;
  logger: Logger;
  exportsDir: string;
  backupConfig: BackupConfig | undefined;
  backupRetentionCount: number;
  knowledgeDir: string;
  dbPath: string;
}
