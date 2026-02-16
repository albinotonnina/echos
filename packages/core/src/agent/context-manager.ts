import type { AgentMessage } from '@mariozechner/pi-agent-core';

const DEFAULT_MAX_INPUT_TOKENS = 80_000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function extractMessageText(message: AgentMessage): string {
  if (!('role' in message)) return '';

  switch (message.role) {
    case 'user': {
      if (typeof message.content === 'string') return message.content;
      return message.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text)
        .join(' ');
    }
    case 'assistant': {
      return message.content
        .map((c) => {
          if (c.type === 'text') return c.text;
          if (c.type === 'toolCall') return JSON.stringify(c.arguments);
          return '';
        })
        .join(' ');
    }
    case 'toolResult': {
      return message.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text)
        .join(' ');
    }
    default:
      return '';
  }
}

function estimateMessageTokens(message: AgentMessage): number {
  return estimateTokens(extractMessageText(message));
}

/**
 * Creates a transformContext function that enforces a sliding window
 * on conversation history based on estimated token count.
 *
 * Only cuts at UserMessage boundaries to avoid orphaning ToolResultMessages.
 * If even the last user turn exceeds the budget, it's kept (never returns empty).
 */
export function createContextWindow(
  maxInputTokens: number = DEFAULT_MAX_INPUT_TOKENS,
): (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]> {
  return async (messages: AgentMessage[]): Promise<AgentMessage[]> => {
    if (messages.length === 0) return messages;

    // Estimate total tokens
    let totalTokens = 0;
    const tokenCounts = messages.map((m) => {
      const count = estimateMessageTokens(m);
      totalTokens += count;
      return count;
    });

    // Under budget — keep everything
    if (totalTokens <= maxInputTokens) return messages;

    // Find valid cut points: indices where a UserMessage starts a new turn
    const cutPoints: number[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg && 'role' in msg && msg.role === 'user') {
        cutPoints.push(i);
      }
    }

    // If no cut points, return as-is
    if (cutPoints.length === 0) return messages;

    // Try cutting from the earliest cut points until we're under budget
    // We iterate forward through cut points (removing oldest messages first)
    for (let ci = 1; ci < cutPoints.length; ci++) {
      const sliceStart = cutPoints[ci]!;
      let slicedTokens = 0;
      for (let j = sliceStart; j < messages.length; j++) {
        slicedTokens += tokenCounts[j]!;
      }
      if (slicedTokens <= maxInputTokens) {
        return messages.slice(sliceStart);
      }
    }

    // Even the last user turn exceeds budget — keep it anyway
    const lastCut = cutPoints[cutPoints.length - 1]!;
    return messages.slice(lastCut);
  };
}
