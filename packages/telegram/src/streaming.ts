import type { Context } from 'grammy';
import type { Agent, AgentEvent } from '@mariozechner/pi-agent-core';

const EDIT_DEBOUNCE_MS = 1000;
const MAX_MESSAGE_LENGTH = 4096;

export async function streamAgentResponse(
  agent: Agent,
  prompt: string,
  ctx: Context,
): Promise<void> {
  let messageId: number | undefined;
  let textBuffer = '';
  let lastEditTime = 0;
  let editTimeout: ReturnType<typeof setTimeout> | undefined;

  const updateMessage = async (): Promise<void> => {
    if (!messageId || !textBuffer) return;

    const truncated =
      textBuffer.length > MAX_MESSAGE_LENGTH
        ? textBuffer.slice(0, MAX_MESSAGE_LENGTH - 3) + '...'
        : textBuffer;

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

  // Final update with complete response
  if (textBuffer) {
    await updateMessage();
  } else {
    await ctx.api.editMessageText(ctx.chat!.id, messageId, 'Done.');
  }
}
