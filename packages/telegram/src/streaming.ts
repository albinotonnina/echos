import type { Context } from 'grammy';
import type { Agent, AgentEvent, AgentMessage } from '@mariozechner/pi-agent-core';

const EDIT_DEBOUNCE_MS = 1000;
const MAX_MESSAGE_LENGTH = 4096;

/**
 * Extract text content from an assistant AgentMessage.
 */
function extractTextFromMessage(message: AgentMessage): string {
  if (!('role' in message) || message.role !== 'assistant') return '';
  return message.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

export async function streamAgentResponse(
  agent: Agent,
  prompt: string,
  ctx: Context,
): Promise<void> {
  let messageId: number | undefined;
  let textBuffer = '';
  let lastEditTime = 0;
  let editTimeout: ReturnType<typeof setTimeout> | undefined;
  let lastAssistantMessage: AgentMessage | undefined;

  const updateMessage = async (text?: string): Promise<void> => {
    const content = text ?? textBuffer;
    if (!messageId || !content) return;

    const truncated =
      content.length > MAX_MESSAGE_LENGTH
        ? content.slice(0, MAX_MESSAGE_LENGTH - 3) + '...'
        : content;

    try {
      await ctx.api.editMessageText(ctx.chat!.id, messageId, truncated);
      lastEditTime = Date.now();
    } catch {
      // Edit may fail if content unchanged
    }
  };

  const unsubscribe = agent.subscribe((event: AgentEvent) => {
    if (event.type === 'message_update' && 'assistantMessageEvent' in event) {
      const ame = event.assistantMessageEvent;
      if (ame.type === 'text_delta') {
        textBuffer += ame.delta;

        if (!messageId) return;

        const now = Date.now();
        if (now - lastEditTime > EDIT_DEBOUNCE_MS) {
          void updateMessage();
        } else if (!editTimeout) {
          editTimeout = setTimeout(() => {
            editTimeout = undefined;
            void updateMessage();
          }, EDIT_DEBOUNCE_MS);
        }
      }
    }

    // Capture the final assistant message as fallback for text extraction
    if (event.type === 'message_end' && 'message' in event) {
      lastAssistantMessage = event.message;
    }

    if (event.type === 'tool_execution_start') {
      textBuffer += `\n\n_[Using ${event.toolName}...]_`;
      void updateMessage();
    }
  });

  // Send initial "thinking" message
  const sent = await ctx.reply('_Thinking..._', { parse_mode: 'Markdown' });
  messageId = sent.message_id;

  // Prepend current date/time context to the prompt
  const now = new Date();
  const contextualPrompt = `[Current date/time: ${now.toISOString()} (${now.toLocaleString('en-US', { timeZone: 'UTC' })} UTC)]\n\n${prompt}`;

  try {
    await agent.prompt(contextualPrompt);
  } finally {
    unsubscribe();
    if (editTimeout) clearTimeout(editTimeout);
  }

  // Check for agent errors (pi-agent-core swallows errors internally)
  const agentError = agent.state.error;

  if (textBuffer) {
    // Stream captured text deltas — normal path
    await updateMessage();
  } else if (agentError) {
    // Agent encountered an error (e.g., API key invalid, network failure)
    await updateMessage(`⚠️ Error: ${agentError}`);
  } else if (lastAssistantMessage) {
    // Fallback: extract text from the final assistant message
    const fallbackText = extractTextFromMessage(lastAssistantMessage);
    if (fallbackText) {
      await updateMessage(fallbackText);
    } else {
      await updateMessage('Done.');
    }
  } else {
    await updateMessage('Done.');
  }
}
