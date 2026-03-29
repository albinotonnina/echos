import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentTool, ThinkingLevel } from '@mariozechner/pi-agent-core';
import { streamSimple } from '@mariozechner/pi-ai';
import type { Logger } from 'pino';
import { buildSystemPrompt } from './system-prompt.js';
import { resolveModel } from './model-resolver.js';
import { createContextWindow } from './context-manager.js';
import { echosConvertToLlm } from './messages.js';
import {
  createNoteTool,
  searchKnowledgeTool,
  getNoteTool,
  listNotesTool,
  updateNoteTool,
  deleteNoteTool,
  restoreNoteTool,
  listTrashTool,
  addReminderTool,
  completeReminderTool,
  listRemindersTool,
  linkNotesTool,
  rememberAboutMeTool,
  recallKnowledgeTool,
  createCategorizeNoteTool,
  markContentTool,
  createSetAgentVoiceTool,
  createExportNotesTool,
  listTodosTool,
  createManageTagsTool,
  createReadingQueueTool,
  createReadingStatsTool,
  createKnowledgeStatsTool,
  saveConversationTool,
  createManageBackupsTool,
  noteHistoryTool,
  restoreVersionTool,
  createExploreGraphTool,
  createSuggestLinksTool,
  searchConversationsTool,
} from './tools/index.js';
import type { BackupConfig } from '../backup/index.js';
import type { SqliteStorage } from '../storage/sqlite.js';
import type { MarkdownStorage } from '../storage/markdown.js';
import type { VectorStorage } from '../storage/vectordb.js';
import type { SearchService } from '../storage/search.js';
import { createRevisionStorage } from '../storage/revisions.js';

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
}

function pickApiKey(provider: string, deps: AgentDeps): string {
  if (provider === 'anthropic') {
    if (!deps.anthropicApiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is required when using an Anthropic model. Set it in your environment.',
      );
    }
    return deps.anthropicApiKey;
  }
  if (!deps.llmApiKey) {
    throw new Error(
      'LLM_API_KEY is required when using a non-Anthropic model. Set it in your environment.',
    );
  }
  return deps.llmApiKey;
}

export function createEchosAgent(deps: AgentDeps): Agent {
  const model = resolveModel(
    deps.modelId ?? 'claude-haiku-4-5-20251001',
    deps.llmBaseUrl,
  );
  const apiKey = pickApiKey(model.provider as string, deps);

  // Prompt caching is only supported by Anthropic models
  const effectiveCacheRetention =
    (model.provider as string) === 'anthropic' ? (deps.cacheRetention ?? 'long') : 'none';

  const revisions = createRevisionStorage(deps.sqlite.db);

  const storageDeps = {
    sqlite: deps.sqlite,
    markdown: deps.markdown,
    vectorDb: deps.vectorDb,
    generateEmbedding: deps.generateEmbedding,
  };

  const MEMORY_INJECT_LIMIT = 15;
  const topMemories = deps.sqlite.listTopMemories(MEMORY_INJECT_LIMIT + 1);
  const hasMore = topMemories.length > MEMORY_INJECT_LIMIT;
  const memories = topMemories.slice(0, MEMORY_INJECT_LIMIT);
  const agentVoice = deps.sqlite.getAgentVoice();

  // Mutable ref so the set_agent_voice tool can update the agent mid-session
  let agentRef: Agent | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coreTools: AgentTool<any>[] = deps.disableCoreTools ? [] : [
    createNoteTool(storageDeps),
    searchKnowledgeTool({
      search: deps.search,
      generateEmbedding: deps.generateEmbedding,
    }),
    getNoteTool({ sqlite: deps.sqlite, markdown: deps.markdown }),
    listNotesTool({ sqlite: deps.sqlite }),
    updateNoteTool({ ...storageDeps, revisions }),
    deleteNoteTool({
      sqlite: deps.sqlite,
      markdown: deps.markdown,
      vectorDb: deps.vectorDb,
    }),
    restoreNoteTool({
      sqlite: deps.sqlite,
      markdown: deps.markdown,
    }),
    listTrashTool({ sqlite: deps.sqlite }),
    addReminderTool({ sqlite: deps.sqlite }),
    completeReminderTool({ sqlite: deps.sqlite }),
    listRemindersTool({ sqlite: deps.sqlite }),
    listTodosTool({ sqlite: deps.sqlite }),
    linkNotesTool({ sqlite: deps.sqlite, markdown: deps.markdown }),
    markContentTool({ sqlite: deps.sqlite, markdown: deps.markdown }),
    rememberAboutMeTool({ sqlite: deps.sqlite }),
    recallKnowledgeTool({ sqlite: deps.sqlite }),
    createCategorizeNoteTool({
      ...storageDeps,
      ...(deps.anthropicApiKey !== undefined ? { anthropicApiKey: deps.anthropicApiKey } : {}),
      ...(deps.llmApiKey !== undefined ? { llmApiKey: deps.llmApiKey } : {}),
      ...(deps.llmBaseUrl !== undefined ? { llmBaseUrl: deps.llmBaseUrl } : {}),
      ...(deps.modelId !== undefined ? { modelId: deps.modelId } : {}),
      logger: deps.logger,
    }),
    createSetAgentVoiceTool({
      sqlite: deps.sqlite,
      onVoiceChange: (instruction) => {
        if (agentRef) {
          const newPrompt = buildSystemPrompt(memories, hasMore, instruction || null);
          agentRef.setSystemPrompt(newPrompt);
        }
      },
    }),
    createExportNotesTool({
      sqlite: deps.sqlite,
      markdown: deps.markdown,
      exportsDir: deps.exportsDir ?? './data/exports',
    }),
    createManageTagsTool({ sqlite: deps.sqlite, markdown: deps.markdown }),
    createReadingQueueTool({ sqlite: deps.sqlite }),
    createReadingStatsTool({ sqlite: deps.sqlite }),
    createKnowledgeStatsTool({
      sqlite: deps.sqlite,
      knowledgeDir: deps.knowledgeDir ?? './data/knowledge',
      dbPath: deps.dbPath ?? './data/db',
    }),
    saveConversationTool(storageDeps),
    ...(deps.backupConfig
      ? [
          createManageBackupsTool({
            backupConfig: deps.backupConfig,
            retentionCount: deps.backupRetentionCount ?? 7,
          }),
        ]
      : []),
    noteHistoryTool({ sqlite: deps.sqlite, revisions }),
    restoreVersionTool({ ...storageDeps, revisions }),
    createExploreGraphTool({
      sqlite: deps.sqlite,
      search: deps.search,
      generateEmbedding: deps.generateEmbedding,
    }),
    createSuggestLinksTool({
      sqlite: deps.sqlite,
      vectorDb: deps.vectorDb,
      generateEmbedding: deps.generateEmbedding,
    }),
    searchConversationsTool({
      search: deps.search,
      generateEmbedding: deps.generateEmbedding,
    }),
  ];

  const tools = [...coreTools, ...(deps.pluginTools ?? [])];

  const systemPrompt = buildSystemPrompt(memories, hasMore, agentVoice);

  deps.logger.info(
    {
      model: model.id,
      thinkingLevel: deps.thinkingLevel ?? 'off',
      cacheRetention: effectiveCacheRetention,
      coreTools: coreTools.length,
      pluginTools: (deps.pluginTools ?? []).length,
      totalTools: tools.length,
      memoriesLoaded: memories.length,
      memoriesTotal: hasMore ? `>${MEMORY_INJECT_LIMIT}` : memories.length,
      agentVoice: agentVoice ? 'custom' : 'default',
    },
    'Creating EchOS agent',
  );

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      tools,
      thinkingLevel: deps.thinkingLevel ?? 'off',
    },
    convertToLlm: echosConvertToLlm,
    transformContext: createContextWindow(80_000),
  });

  // Wire the mutable ref so set_agent_voice can update the system prompt mid-session
  agentRef = agent;

  if (apiKey || deps.logLlmPayloads) {
    agent.streamFn = (m, context, options) =>
      streamSimple(m, context, {
        ...options,
        ...(apiKey ? { apiKey } : {}),
        cacheRetention: effectiveCacheRetention,
        ...(deps.logLlmPayloads
          ? { onPayload: (payload) => deps.logger.debug({ payload }, 'LLM request payload') }
          : {}),
      });
  }

  return agent;
}

export { SYSTEM_PROMPT, buildSystemPrompt } from './system-prompt.js';
