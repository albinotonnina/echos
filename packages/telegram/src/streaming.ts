import type { Context } from 'grammy';
import type { Agent, AgentEvent, AgentMessage } from '@mariozechner/pi-agent-core';
import { isAgentMessageOverflow, createContextMessage, createUserMessage } from '@echos/core';

const EDIT_DEBOUNCE_MS = 1000;
const MAX_MESSAGE_LENGTH = 4096;

export const CONFIRM_MARKER = '[confirm?]';

function stripConfirmMarker(text: string): string {
  return text.replace(/\n?\[confirm\?\]\s*$/, '').trimEnd();
}

// Exact tool name → emoji mapping
const TOOL_EMOJI_MAP: Record<string, string> = {
  create_note: '✏️',
  update_note: '✏️',
  delete_note: '🗑️',
  get_note: '📖',
  list_notes: '🔍',
  search_knowledge: '🔍',
  recall_knowledge: '🧠',
  remember_about_me: '🧠',
  categorize_note: '🏷️',
  link_notes: '🔗',
  mark_content: '🔖',
  save_conversation: '💬',
  add_reminder: '⏰',
  complete_reminder: '✅',
  save_youtube: '📺',
  save_article: '🌐',
  create_content: '✍️',
  get_style_profile: '🎨',
  analyze_my_style: '🎨',
  mark_as_voice_example: '🎙️',
  set_agent_voice: '🎭',
};

// Append a zero-width space so Telegram doesn't render the emoji at giant size
const ZWS = '\u200B';

function getToolEmoji(toolName: string): string {
  return (TOOL_EMOJI_MAP[toolName] ?? '⚙️') + ZWS;
}

/**
 * Convert Claude's standard markdown to Telegram HTML.
 *
 * Telegram HTML supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a href="…">
 * Only &, <, > need escaping in text content — far simpler than MarkdownV2.
 *
 * Strategy:
 *   1. Extract fenced code blocks and inline code first (protect their content).
 *   2. Escape HTML special chars in the remaining text.
 *   3. Convert markdown syntax (headers, bold, italic) to HTML tags.
 *   4. Restore code blocks.
 */
function markdownToHtml(text: string): string {
  // Sentinel chars unlikely to appear in normal text
  const BLOCK = '\x02B';
  const INLINE = '\x02I';
  const SEP = '\x03';

  // 1. Protect fenced code blocks
  const codeBlocks: string[] = [];
  let out = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, content: string) => {
    const safe = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    codeBlocks.push(`<pre>${safe.trim()}</pre>`);
    return `${BLOCK}${codeBlocks.length - 1}${SEP}`;
  });

  // 2. Protect inline code
  const inlineCodes: string[] = [];
  out = out.replace(/`([^`\n]+)`/g, (_, content: string) => {
    const safe = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    inlineCodes.push(`<code>${safe}</code>`);
    return `${INLINE}${inlineCodes.length - 1}${SEP}`;
  });

  // 3. Escape HTML special chars in the remaining text
  out = out.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 4. Convert markdown syntax to HTML tags
  out = out
    // Headers → bold (Telegram HTML has no heading tags).
    // Handles "## Title", "##" alone, and "## " with no content.
    // If the header has content, wrap in <b>; if empty/standalone, remove the marker.
    .replace(/^#{1,6}\s*(.*)$/gm, (_, t: string) => (t.trim() ? `<b>${t.trim()}</b>` : ''))
    // Bold — must come before italic
    .replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>')
    .replace(/__(.+?)__/gs, '<b>$1</b>')
    // Italic
    .replace(/\*([^*\n]+)\*/g, '<i>$1</i>')
    .replace(/_([^_\n]+)_/g, '<i>$1</i>')
    // Strikethrough
    .replace(/~~(.+?)~~/gs, '<s>$1</s>')
    // Links — keep label, drop URL (Telegram validates hrefs strictly)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Horizontal rules — remove
    .replace(/^---+$/gm, '');

  // 5. Restore protected sections
  out = out.replace(new RegExp(`${BLOCK}(\\d+)${SEP}`, 'g'), (_, i) => codeBlocks[+i] ?? '');
  out = out.replace(new RegExp(`${INLINE}(\\d+)${SEP}`, 'g'), (_, i) => inlineCodes[+i] ?? '');

  return out;
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
): Promise<{ botMessageId: number | undefined; finalText: string }> {
  let messageId: number | undefined;
  let textBuffer = '';        // AI response text only — never contains tool indicators
  let statusLine = '💭' + ZWS; // shown only while textBuffer is still empty
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

    // Only convert AI content to HTML; status lines are plain text
    const isAiContent = overrideText !== undefined || textBuffer.length > 0;

    if (isAiContent) {
      const html = markdownToHtml(stripConfirmMarker(raw));
      const truncated =
        html.length > MAX_MESSAGE_LENGTH ? html.slice(0, MAX_MESSAGE_LENGTH - 3) + '...' : html;

      try {
        await ctx.api.editMessageText(ctx.chat!.id, messageId, truncated, {
          parse_mode: 'HTML',
        });
        lastEditTime = Date.now();
      } catch (err) {
        if (err instanceof Error && err.message.toLowerCase().includes('not modified')) return;
        // Ultimate fallback: send the raw text with no parse_mode
        try {
          const stripped = stripConfirmMarker(raw);
          const rawTruncated =
            stripped.length > MAX_MESSAGE_LENGTH ? stripped.slice(0, MAX_MESSAGE_LENGTH - 3) + '...' : stripped;
          await ctx.api.editMessageText(ctx.chat!.id, messageId, rawTruncated);
          lastEditTime = Date.now();
        } catch {
          // Ignore
        }
      }
    } else {
      try {
        await ctx.api.editMessageText(ctx.chat!.id, messageId, raw);
        lastEditTime = Date.now();
      } catch (err) {
        if (err instanceof Error && err.message.toLowerCase().includes('not modified')) return;
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

  // Keep Telegram's native "typing…" indicator alive while the agent processes.
  // It auto-expires after ~5 s, so refresh every 4 s.
  void ctx.api.sendChatAction(ctx.chat!.id, 'typing');
  const typingInterval = setInterval(() => {
    void ctx.api.sendChatAction(ctx.chat!.id, 'typing');
  }, 4000);

  const now = new Date();
  try {
    await agent.prompt([
      createContextMessage(`Current date/time: ${now.toISOString()} (${now.toLocaleString('en-US', { timeZone: 'UTC' })} UTC)`),
      createUserMessage(prompt),
    ]);
  } finally {
    clearInterval(typingInterval);
    unsubscribe();
    if (editTimeout) clearTimeout(editTimeout);
  }

  const agentError = agent.state.error;

  if (textBuffer) {
    await updateMessage();
  } else if (agentError && isAgentMessageOverflow(lastAssistantMessage, agent.state.model.contextWindow)) {
    await updateMessage('⚠️ Conversation history is too long. Use /reset to start a new session.');
  } else if (agentError) {
    await updateMessage(`⚠️ Error: ${agentError}`);
  } else if (lastAssistantMessage) {
    const fallbackText = extractTextFromMessage(lastAssistantMessage);
    await updateMessage(fallbackText || 'Done.');
  } else {
    await updateMessage('Done.');
  }

  // React to the original user message to signal completion
  const userMessageId = ctx.message?.message_id;
  if (userMessageId) {
    await ctx.api.setMessageReaction(
      ctx.chat!.id,
      userMessageId,
      [{ type: 'emoji', emoji: agentError ? '😱' : '👌' }],
    ).catch(() => undefined);
  }

  return { botMessageId: messageId, finalText: textBuffer };
}
