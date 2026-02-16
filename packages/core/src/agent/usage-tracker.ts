import type { Agent } from '@mariozechner/pi-agent-core';

export interface SessionUsage {
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
  contextWindowPercent: number;
}

const ZERO_USAGE: SessionUsage = {
  messageCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalCost: 0,
  contextWindowPercent: 0,
};

/**
 * Computes session usage from the agent's message history.
 * Sums usage fields from all assistant messages and computes
 * context window utilization from the most recent one.
 */
export function computeSessionUsage(agent: Agent): SessionUsage {
  const messages = agent.state.messages;
  if (messages.length === 0) return { ...ZERO_USAGE };

  const assistantMessages = messages.filter(
    (m) => 'role' in m && m.role === 'assistant',
  );

  if (assistantMessages.length === 0) return { ...ZERO_USAGE };

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let totalCost = 0;

  for (const msg of assistantMessages) {
    if (!('usage' in msg)) continue;
    const usage = msg.usage;
    inputTokens += usage.input;
    outputTokens += usage.output;
    cacheReadTokens += usage.cacheRead;
    cacheWriteTokens += usage.cacheWrite;
    totalCost += usage.cost.total;
  }

  // Context window percent from last assistant message
  let contextWindowPercent = 0;
  const lastAssistant = assistantMessages[assistantMessages.length - 1]!;
  if ('usage' in lastAssistant) {
    const contextWindow = agent.state.model.contextWindow;
    if (contextWindow > 0) {
      contextWindowPercent = (lastAssistant.usage.input / contextWindow) * 100;
    }
  }

  return {
    messageCount: messages.length,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalCost,
    contextWindowPercent,
  };
}
