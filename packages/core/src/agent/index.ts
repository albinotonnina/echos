import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentTool, ThinkingLevel } from '@mariozechner/pi-agent-core';
import { getModel, streamSimple } from '@mariozechner/pi-ai';
import type { Logger } from 'pino';
import { buildSystemPrompt } from './system-prompt.js';
import { createContextWindow } from './context-manager.js';
import {
  createNoteTool,
  searchKnowledgeTool,
  getNoteTool,
  listNotesTool,
  updateNoteTool,
  deleteNoteTool,
  addReminderTool,
  completeReminderTool,
  linkNotesTool,
  rememberAboutMeTool,
  recallKnowledgeTool,
  createCategorizeNoteTool,
} from './tools/index.js';
import type { SqliteStorage } from '../storage/sqlite.js';
import type { MarkdownStorage } from '../storage/markdown.js';
import type { VectorStorage } from '../storage/vectordb.js';
import type { SearchService } from '../storage/search.js';

export interface AgentDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
  vectorDb: VectorStorage;
  search: SearchService;
  generateEmbedding: (text: string) => Promise<number[]>;
  anthropicApiKey: string;
  modelId?: string;
  logger: Logger;
  /** Reasoning/thinking level for the LLM (set THINKING_LEVEL=off|minimal|low|medium|high|xhigh) */
  thinkingLevel?: ThinkingLevel;
  /** Log raw LLM request payloads at debug level (set LOG_LLM_PAYLOADS=true) */
  logLlmPayloads?: boolean;
  /** Additional tools registered by plugins */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pluginTools?: AgentTool<any>[];
}

export function createEchosAgent(deps: AgentDeps): Agent {
  const model = getModel(
    'anthropic',
    (deps.modelId ?? 'claude-3-5-haiku-20241022') as 'claude-3-5-haiku-20241022',
  );

  const storageDeps = {
    sqlite: deps.sqlite,
    markdown: deps.markdown,
    vectorDb: deps.vectorDb,
    generateEmbedding: deps.generateEmbedding,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coreTools: AgentTool<any>[] = [
    createNoteTool(storageDeps),
    searchKnowledgeTool({
      search: deps.search,
      generateEmbedding: deps.generateEmbedding,
    }),
    getNoteTool({ sqlite: deps.sqlite, markdown: deps.markdown }),
    listNotesTool({ sqlite: deps.sqlite }),
    updateNoteTool(storageDeps),
    deleteNoteTool({
      sqlite: deps.sqlite,
      markdown: deps.markdown,
      vectorDb: deps.vectorDb,
    }),
    addReminderTool({ sqlite: deps.sqlite }),
    completeReminderTool({ sqlite: deps.sqlite }),
    linkNotesTool({ sqlite: deps.sqlite, markdown: deps.markdown }),
    rememberAboutMeTool({ sqlite: deps.sqlite }),
    recallKnowledgeTool({ sqlite: deps.sqlite }),
    createCategorizeNoteTool({
      ...storageDeps,
      anthropicApiKey: deps.anthropicApiKey,
      logger: deps.logger,
    }),
  ];

  const tools = [...coreTools, ...(deps.pluginTools ?? [])];

  const MEMORY_INJECT_LIMIT = 15;
  const topMemories = deps.sqlite.listTopMemories(MEMORY_INJECT_LIMIT + 1);
  const hasMore = topMemories.length > MEMORY_INJECT_LIMIT;
  const memories = topMemories.slice(0, MEMORY_INJECT_LIMIT);
  const systemPrompt = buildSystemPrompt(memories, hasMore);

  deps.logger.info(
    { model: model.id, thinkingLevel: deps.thinkingLevel ?? 'off', coreTools: coreTools.length, pluginTools: (deps.pluginTools ?? []).length, totalTools: tools.length, memoriesLoaded: memories.length, memoriesTotal: hasMore ? `>${MEMORY_INJECT_LIMIT}` : memories.length },
    'Creating EchOS agent',
  );

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      tools,
      thinkingLevel: deps.thinkingLevel ?? 'off',
    },
    transformContext: createContextWindow(80_000),
  });

  if (deps.logLlmPayloads) {
    agent.streamFn = (m, context, options) =>
      streamSimple(m, context, {
        ...options,
        onPayload: (payload) => deps.logger.debug({ payload }, 'LLM request payload'),
      });
  }

  return agent;
}

export { SYSTEM_PROMPT, buildSystemPrompt } from './system-prompt.js';
