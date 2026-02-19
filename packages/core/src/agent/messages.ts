/**
 * EchOS custom agent message types.
 *
 * Declaration merging extends pi-agent-core's AgentMessage union with
 * EchOS-specific message types. Custom messages are filtered by
 * echosConvertToLlm before being sent to the LLM provider.
 */

import '@mariozechner/pi-agent-core';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { Message } from '@mariozechner/pi-ai';

declare module '@mariozechner/pi-agent-core' {
  interface CustomAgentMessages {
    /**
     * Injects context (e.g. current date/time) that is prepended to the
     * immediately following user message before the LLM call. Never sent
     * as a standalone message — always merged and invisible in LLM history.
     */
    echos_context: EchosContextMessage;
  }
}

export interface EchosContextMessage {
  role: 'echos_context';
  content: string;
  timestamp: number;
}

/** Create a typed context injection message. */
export function createContextMessage(content: string): EchosContextMessage {
  return { role: 'echos_context', content, timestamp: Date.now() };
}

/** Create a typed user message. */
export function createUserMessage(content: string): {
  role: 'user';
  content: string;
  timestamp: number;
} {
  return { role: 'user' as const, content, timestamp: Date.now() };
}

/**
 * Custom convertToLlm for EchOS.
 *
 * Handles standard LLM message types (user, assistant, toolResult) plus
 * EchOS-specific types:
 * - echos_context: prepended to the content of the next user message.
 *   Dropped if no user message follows (should not happen in normal flow).
 */
export function echosConvertToLlm(messages: AgentMessage[]): Message[] {
  const result: Message[] = [];
  let pendingContext = '';

  for (const msg of messages) {
    if (!('role' in msg)) continue;

    if (msg.role === 'echos_context') {
      const ctx = msg as EchosContextMessage;
      pendingContext = pendingContext
        ? `${pendingContext}\n${ctx.content}`
        : ctx.content;
      continue;
    }

    if (msg.role === 'user') {
      if (pendingContext) {
        const userContent =
          typeof msg.content === 'string'
            ? msg.content
            : (msg.content as Array<{ type: string; text?: string }>)
                .filter((c) => c.type === 'text')
                .map((c) => c.text ?? '')
                .join('');
        result.push({
          role: 'user' as const,
          content: `${pendingContext}\n\n${userContent}`,
          timestamp: msg.timestamp,
        });
        pendingContext = '';
      } else {
        result.push(msg as Message);
      }
      continue;
    }

    if (msg.role === 'assistant' || msg.role === 'toolResult') {
      result.push(msg as Message);
    }
  }

  return result;
}
