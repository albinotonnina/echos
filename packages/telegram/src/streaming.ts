import type { Context } from 'grammy';
import type { Agent, AgentEvent, AgentMessage } from '@mariozechner/pi-agent-core';
import telegramifyMarkdown from 'telegramify-markdown';

const EDIT_DEBOUNCE_MS = 1000;
const MAX_MESSAGE_LENGTH = 4096;

const TOOL_EMOJIS: Record<string, string> = {
  search: '🔍',
  list: '🔍',
  get: '📖',
  read: '📖',
  create: '💾',
  save: '💾',
  add: '💾',
  delete: '🗑️',
  remove: '🗑️',
  update: '✏️',
  edit: '✏️',
  youtube: '📺',
  article: '🌐',
  web: '🌐',
  transcribe: '🎙️',
  voice: '🎙️',
};

function getToolEmoji(toolName: string): string {
  const name = toolName.toLowerCase();
  for (const [key, emoji] of Object.entries(TOOL_EMOJIS)) {
    if (name.includes(key)) return emoji;
  }
  return '⚙️';
}

/**
 * Convert standard markdown (as produced by Claude) to Telegram MarkdownV2.
 * Falls back to plain text if conversion fails (e.g. mid-stream unclosed syntax).
 */
function toTelegramMarkdown(text: string): string {
  try {
    return telegramifyMarkdown(text, 'escape');
  } catch {
    return text;
  }
}

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
  let textBuffer = '';        // AI response text only — never contains tool indicators
  let statusLine = '💭'; // shown only while textBuffer is still empty
  let lastEditTime = 0;
  let editTimeout: ReturnType<typeof setTimeout> | undefined;
  let lastAssistantMessage: AgentMessage | undefined;

  /**
   * Send an edit with the current content.
   * While no AI text has arrived yet, shows the status line (e.g. an emoji).
   * Once AI text is flowing, shows only the AI text — status disappears.
   */
  const updateMessage = async (overrideText?: string): Promise<void> => {
    if (!messageId) return;

    // Use explicit override, then AI buffer, then status indicator
    const raw = overrideText ?? (textBuffer || statusLine);
    if (!raw) return;

    // Only convert AI content through telegramify; status lines are plain text
    const isAiContent = overrideText !== undefined || textBuffer.length > 0;
    const converted = isAiContent ? toTelegramMarkdown(raw) : raw;

    const truncated =
      converted.length > MAX_MESSAGE_LENGTH
        ? converted.slice(0, MAX_MESSAGE_LENGTH - 3) + '...'
        : converted;

    try {
      if (isAiContent) {
        await ctx.api.editMessageText(ctx.chat!.id, messageId, truncated, {
          parse_mode: 'MarkdownV2',
        });
      } else {
        await ctx.api.editMessageText(ctx.chat!.id, messageId, truncated);
      }
      lastEditTime = Date.now();
    } catch (err) {
      if (err instanceof Error && err.message.toLowerCase().includes('not modified')) return;

      // Fallback: plain text so the user still sees something
      if (isAiContent) {
        try {
          const rawTruncated =
            raw.length > MAX_MESSAGE_LENGTH ? raw.slice(0, MAX_MESSAGE_LENGTH - 3) + '...' : raw;
          await ctx.api.editMessageText(ctx.chat!.id, messageId, rawTruncated);
          lastEditTime = Date.now();
        } catch {
          // Ignore
        }
      }
    }
  };

  const scheduleUpdate = (): void => {
    const now = Date.now();
    if (now - lastEditTime > EDIT_DEBOUNCE_MS) {
      void updateMessage();
    } else if (!editTimeout) {
      editTimeout = setTimeout(() => {
        editTimeout = undefined;
        void updateMessage();
      }, EDIT_DEBOUNCE_MS);
    }
  };

  const unsubscribe = agent.subscribe((event: AgentEvent) => {
    if (event.type === 'message_update' && 'assistantMessageEvent' in event) {
      const ame = event.assistantMessageEvent;
      if (ame.type === 'text_delta') {
        textBuffer += ame.delta;
        if (messageId) scheduleUpdate();
      }
    }

    if (event.type === 'message_end' && 'message' in event) {
      lastAssistantMessage = event.message;
    }

    if (event.type === 'tool_execution_start') {
      const emoji = getToolEmoji(event.toolName);
      // Update status indicator only — never pollutes the AI text buffer
      statusLine = emoji;
      // Only push the status update when no AI text has arrived yet
      if (!textBuffer && messageId) void updateMessage();
    }
  });

  // Send initial status message
  const sent = await ctx.reply(statusLine);
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

  const agentError = agent.state.error;

  if (textBuffer) {
    await updateMessage();
  } else if (agentError) {
    await updateMessage(`⚠️ Error: ${agentError}`);
  } else if (lastAssistantMessage) {
    const fallbackText = extractTextFromMessage(lastAssistantMessage);
    await updateMessage(fallbackText || 'Done.');
  } else {
    await updateMessage('Done.');
  }
}
