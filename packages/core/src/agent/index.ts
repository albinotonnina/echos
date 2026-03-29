import { Agent } from '@mariozechner/pi-agent-core';
import { streamSimple } from '@mariozechner/pi-ai';
import { buildSystemPrompt } from './system-prompt.js';
import { resolveModel } from './model-resolver.js';
import { createContextWindow } from './context-manager.js';
import { echosConvertToLlm } from './messages.js';
import { createAgentTools } from './create-agent-tools.js';
import type { AgentDeps } from './types.js';

export type { AgentDeps } from './types.js';

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

  const MEMORY_INJECT_LIMIT = 15;
  const topMemories = deps.sqlite.listTopMemories(MEMORY_INJECT_LIMIT + 1);
  const hasMore = topMemories.length > MEMORY_INJECT_LIMIT;
  const memories = topMemories.slice(0, MEMORY_INJECT_LIMIT);
  const agentVoice = deps.sqlite.getAgentVoice();

  // Mutable ref so the set_agent_voice tool can update the agent mid-session
  const agentRef: { current: Agent | null } = { current: null };

  const coreTools = deps.disableCoreTools
    ? []
    : createAgentTools({
        deps: {
          sqlite: deps.sqlite,
          markdown: deps.markdown,
          vectorDb: deps.vectorDb,
          search: deps.search,
          generateEmbedding: deps.generateEmbedding,
          anthropicApiKey: deps.anthropicApiKey,
          llmApiKey: deps.llmApiKey,
          llmBaseUrl: deps.llmBaseUrl,
          modelId: deps.modelId,
          logger: deps.logger,
          exportsDir: deps.exportsDir ?? './data/exports',
          backupConfig: deps.backupConfig,
          backupRetentionCount: deps.backupRetentionCount ?? 7,
          knowledgeDir: deps.knowledgeDir ?? './data/knowledge',
          dbPath: deps.dbPath ?? './data/db',
        },
        memories,
        hasMore,
        agentRef,
      });

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
  agentRef.current = agent;

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
