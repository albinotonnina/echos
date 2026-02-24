import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentTool, ThinkingLevel } from '@mariozechner/pi-agent-core';
import { getModel, streamSimple } from '@mariozechner/pi-ai';
import type { Logger } from 'pino';
import { buildSystemPrompt } from './system-prompt.js';
import { createContextWindow } from './context-manager.js';
import { echosConvertToLlm } from './messages.js';
import {
  createNoteTool,
  searchKnowledgeTool,
  getNoteTool,
  listNotesTool,
  updateNoteTool,
  deleteNoteTool,
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
  /** Named model presets available for /model switching */
  modelPresets?: { balanced?: string; deep?: string };
  /** Reasoning/thinking level for the LLM (set THINKING_LEVEL=off|minimal|low|medium|high|xhigh) */
  thinkingLevel?: ThinkingLevel;
  /** Log raw LLM request payloads at debug level (set LOG_LLM_PAYLOADS=true) */
  logLlmPayloads?: boolean;
  /** Additional tools registered by plugins */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pluginTools?: AgentTool<any>[];
  /** Directory for writing temporary export files (default: ./data/exports) */
  exportsDir?: string;
}

export function createEchosAgent(deps: AgentDeps): Agent {
  const model = getModel(
    'anthropic',
    (deps.modelId ?? 'claude-haiku-4-5-20251001') as Parameters<typeof getModel>[1],
  );

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
    listRemindersTool({ sqlite: deps.sqlite }),
    linkNotesTool({ sqlite: deps.sqlite, markdown: deps.markdown }),
    markContentTool({ sqlite: deps.sqlite, markdown: deps.markdown }),
    rememberAboutMeTool({ sqlite: deps.sqlite }),
    recallKnowledgeTool({ sqlite: deps.sqlite }),
    createCategorizeNoteTool({
      ...storageDeps,
      anthropicApiKey: deps.anthropicApiKey,
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
  ];

  const tools = [...coreTools, ...(deps.pluginTools ?? [])];

  const systemPrompt = buildSystemPrompt(memories, hasMore, agentVoice);

  deps.logger.info(
    {
      model: model.id,
      thinkingLevel: deps.thinkingLevel ?? 'off',
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
