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
  const model = resolveModel(deps.modelId ?? 'claude-haiku-4-5-20251001', deps.llmBaseUrl);
  const apiKey = pickApiKey(model.provider as string, deps);

  // Override maxTokens for Groq free tier (8K TPM limit)
  // Groq counts prompt + max_completion_tokens towards TPM
  // Most responses are <500 tokens, so 1024 is plenty
  if ((model.provider as string) === 'groq' || model.baseUrl?.includes('groq.com')) {
    model.maxTokens = 1024;
  }

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

  // Estimate system prompt + tools token count for debugging
  const systemPromptTokens = Math.ceil(systemPrompt.length / 4);
  const toolsTokens = tools.reduce((sum, tool) => {
    const toolJson = JSON.stringify({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    });
    return sum + Math.ceil(toolJson.length / 4);
  }, 0);
  const totalBaseTokens = systemPromptTokens + toolsTokens;

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
      maxContextTokens: deps.maxContextTokens,
      contextWindow: model.contextWindow,
      tokenEstimates: {
        systemPrompt: systemPromptTokens,
        allTools: toolsTokens,
        totalBase: totalBaseTokens,
        note: 'Actual LLM request tokens may differ; this is a rough char/4 estimate',
      },
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
    transformContext: createContextWindow(deps.maxContextTokens ?? 80_000),
  });

  // Wire the mutable ref so set_agent_voice can update the system prompt mid-session
  agentRef.current = agent;

  // Always set custom streamFn so we can log payloads
  agent.streamFn = (model, context, options) => {
    // Log payload size for debugging
    const toolNames = (context.tools || []).map((t: { name: string }) => t.name);
    const systemPromptLen = (context.systemPrompt || '').length;
    const toolsJsonLen = JSON.stringify(context.tools).length;
    const totalPayloadLen = systemPromptLen + toolsJsonLen;
    console.log(`[LLM-PAYLOAD] systemPrompt=${systemPromptLen} chars, tools=${toolNames.length} (${toolsJsonLen} chars), est. ~${Math.ceil(totalPayloadLen / 4)} tokens`);
    return streamSimple(model, context, {
      ...options,
      ...(apiKey ? { apiKey } : {}),
      cacheRetention: effectiveCacheRetention,
    });
  };

  return agent;
}

export { SYSTEM_PROMPT, buildSystemPrompt } from './system-prompt.js';
