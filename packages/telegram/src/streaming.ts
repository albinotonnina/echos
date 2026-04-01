import { readFile, unlink } from 'node:fs/promises';
import type { Context } from 'grammy';
import { InputFile, InlineKeyboard } from 'grammy';
import type { Agent, AgentEvent, AgentMessage } from '@mariozechner/pi-agent-core';
import { isAgentMessageOverflow, createContextMessage, createUserMessage, type ExportFileResult } from '@echos/core';
import {
  buildReadingQueueKeyboard,
  buildListNotesKeyboard,
  buildRemindersKeyboard,
} from './keyboards.js';

const EDIT_DEBOUNCE_MS = 1000;
const MAX_MESSAGE_LENGTH = 4096;

// --- Last response store (for /save command) ---
// Scoped by (chatId, userId) so private responses can't leak into group chats.
const LAST_RESPONSE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface LastResponseEntry {
  text: string;
  storedAt: number;
}

const lastResponses = new Map<string, LastResponseEntry>();

function lastResponseKey(chatId: number, userId: number): string {
  return `${chatId}:${userId}`;
}

export function setLastResponse(chatId: number, userId: number, text: string): void {
  // Prune expired entries opportunistically (cheap — runs at most once per response)
  const now = Date.now();
  for (const [k, v] of lastResponses) {
    if (now - v.storedAt > LAST_RESPONSE_TTL_MS) lastResponses.delete(k);
  }
  lastResponses.set(lastResponseKey(chatId, userId), { text, storedAt: now });
}

export function getLastResponse(chatId: number, userId: number): string | undefined {
  const entry = lastResponses.get(lastResponseKey(chatId, userId));
  if (!entry) return undefined;
  if (Date.now() - entry.storedAt > LAST_RESPONSE_TTL_MS) {
    lastResponses.delete(lastResponseKey(chatId, userId));
    return undefined;
  }
  return entry.text;
}

export function clearLastResponse(userId: number): void {
  for (const key of lastResponses.keys()) {
    if (key.endsWith(`:${userId}`)) lastResponses.delete(key);
  }
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
  export_notes: '📦',
};

// Append a zero-width space so Telegram doesn't render the emoji at giant size
const ZWS = '\u200B';

function getToolEmoji(toolName: string): string {
  return (TOOL_EMOJI_MAP[toolName] ?? '⚙️') + ZWS;
}

/**
 * Split text into chunks no longer than maxLen, preferring paragraph breaks.
 */
function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = '';
  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length <= maxLen) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      // If a single paragraph exceeds maxLen, hard-split it
      if (para.length > maxLen) {
        for (let i = 0; i < para.length; i += maxLen) {
          chunks.push(para.slice(i, i + maxLen));
        }
        current = '';
      } else {
        current = para;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
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
export function markdownToHtml(text: string): string {
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
    // Links → Telegram-safe anchor tags (only http/https to prevent javascript: injection)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, url: string) => {
      const decodedUrl = url.replace(/&amp;/g, '&');
      if (!/^https?:\/\//i.test(decodedUrl)) {
        return label;
      }
      const safeHref = url.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      return `<a href="${safeHref}">${label}</a>`;
    })
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

const ANTHROPIC_ERROR_MESSAGES: Record<string, string> = {
  overloaded_error: 'Anthropic is overloaded at the moment — please try again in a bit.',
  rate_limit_error: 'You\'ve hit the rate limit — please wait a moment before trying again.',
  api_error: 'Anthropic returned an unexpected error — please try again.',
  authentication_error: 'There\'s an issue with the Anthropic API key.',
  permission_error: 'The Anthropic API key doesn\'t have permission for this request.',
  invalid_request_error: 'The request was invalid — please try rephrasing.',
};

function friendlyAnthropicError(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { type?: string; message?: string } };
    const type = parsed.error?.type ?? '';
    return ANTHROPIC_ERROR_MESSAGES[type] ?? parsed.error?.message ?? raw;
  } catch {
    return raw;
  }
}

export async function streamAgentResponse(
  agent: Agent,
  prompt: string,
  ctx: Context,
): Promise<void> {
  let messageId: number | undefined;
  let textBuffer = '';        // AI response text only — never contains tool indicators
  let statusLine = '💭' + ZWS; // shown only while textBuffer is still empty
  let lastEditTime = 0;
  let editTimeout: ReturnType<typeof setTimeout> | undefined;
  let lastAssistantMessage: AgentMessage | undefined;

  let toolExecuted = false;
  const pendingExports: ExportFileResult[] = [];
  const pendingContent: string[] = [];
  let pendingKeyboard: InlineKeyboard | undefined;

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
      const html = markdownToHtml(raw);
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
          const rawTruncated =
            raw.length > MAX_MESSAGE_LENGTH ? raw.slice(0, MAX_MESSAGE_LENGTH - 3) + '...' : raw;
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
        if (toolExecuted) {
          textBuffer = '';
          toolExecuted = false;
        }
        textBuffer += ame.delta;
        if (messageId) scheduleUpdate();
      }
    }

    if (event.type === 'message_end' && 'message' in event) {
      lastAssistantMessage = event.message;
    }

    if (event.type === 'tool_execution_start') {
      toolExecuted = true;
      const emoji = getToolEmoji(event.toolName);
      // Update status indicator only — never pollutes the AI text buffer
      statusLine = emoji;
      // Only push the status update when no AI text has arrived yet
      if (!textBuffer && messageId) void updateMessage();
    }

    if (event.type === 'tool_execution_end' && !event.isError && event.toolName === 'export_notes') {
      try {
        const resultContent = (event.result as { content?: Array<{ type: string; text?: string }> } | undefined)
          ?.content;
        const textContent = resultContent?.find((c) => c.type === 'text');
        if (textContent?.text) {
          const parsed = JSON.parse(textContent.text) as ExportFileResult;
          if (parsed.type === 'export_file') {
            pendingExports.push(parsed);
          }
        }
      } catch {
        // ignore parse errors — agent will describe the failure in text
      }
    }

    if (event.type === 'tool_execution_end' && !event.isError && event.toolName === 'create_content') {
      try {
        const resultContent = (event.result as { content?: Array<{ type: string; text?: string }> } | undefined)
          ?.content;
        const textContent = resultContent?.find((c) => c.type === 'text');
        if (textContent?.text) {
          pendingContent.push(textContent.text);
        }
      } catch {
        // ignore parse errors
      }
    }

    // Capture actionable tool results for inline keyboards
    if (event.type === 'tool_execution_end' && !event.isError) {
      try {
        const details = (event.result as { details?: Record<string, unknown> } | undefined)?.details;
        const items = details?.['items'] as Array<Record<string, unknown>> | undefined;
        if (items && items.length > 0) {
          let kb: InlineKeyboard | undefined;
          if (event.toolName === 'reading_queue') {
            kb = buildReadingQueueKeyboard(items as Array<{ id: string; title: string; type: string; sourceUrl?: string }>);
          } else if (event.toolName === 'list_notes') {
            kb = buildListNotesKeyboard(items as Array<{ id: string; title: string; type: string; status: string | null }>);
          } else if (event.toolName === 'list_reminders') {
            kb = buildRemindersKeyboard(items as Array<{ id: string; title: string; completed: boolean }>);
          }
          if (kb) pendingKeyboard = kb;
        }
      } catch {
        // ignore — keyboards are non-essential
      }
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
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    await agent.prompt([
      createContextMessage(`Current date/time: ${now.toISOString()} (${now.toLocaleString('en-US', { timeZone: tz })} ${tz})`),
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

    // Store last response for /save command (scoped by chat + user)
    const chatId = ctx.chat!.id;
    const userId = ctx.from?.id;
    if (userId) setLastResponse(chatId, userId, textBuffer);

    // If the response was truncated, attach the full text as a .md file
    const html = markdownToHtml(textBuffer);
    if (html.length > MAX_MESSAGE_LENGTH) {
      try {
        const buf = Buffer.from(textBuffer, 'utf8');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        await ctx.replyWithDocument(new InputFile(buf, `response-${timestamp}.md`), {
          caption: '📎 Full response attached (message was truncated)',
        });
      } catch {
        // Non-fatal: the truncated message was already delivered
      }
    }
  } else if (agentError && isAgentMessageOverflow(lastAssistantMessage, agent.state.model.contextWindow)) {
    await updateMessage('⚠️ Conversation history is too long. Use /reset to start a new session.');
  } else if (agentError) {
    await updateMessage(`⚠️ ${friendlyAnthropicError(agentError)}`);
  } else if (lastAssistantMessage) {
    const fallbackText = extractTextFromMessage(lastAssistantMessage);
    await updateMessage(fallbackText || 'Done.');
  } else {
    await updateMessage('Done.');
  }

  // Deliver any created content — chunk on paragraph boundaries to avoid Telegram's 4096-char limit
  for (const content of pendingContent) {
    const chunks = chunkText(content, MAX_MESSAGE_LENGTH);
    for (const chunk of chunks) {
      try {
        await ctx.reply(markdownToHtml(chunk), { parse_mode: 'HTML' });
      } catch {
        // Non-fatal: try plain text fallback
        try {
          await ctx.reply(chunk);
        } catch {
          // ignore
        }
      }
    }
  }

  // Deliver any exported files
  for (const exportResult of pendingExports) {
    try {
      if (exportResult.inline !== undefined) {
        const buf = Buffer.from(exportResult.inline, 'utf8');
        await ctx.replyWithDocument(new InputFile(buf, exportResult.fileName));
      } else if (exportResult.filePath) {
        try {
          const buf = await readFile(exportResult.filePath);
          await ctx.replyWithDocument(new InputFile(buf, exportResult.fileName));
        } finally {
          await unlink(exportResult.filePath).catch(() => undefined);
        }
      }
    } catch {
      // Non-fatal: agent already described the export in text
    }
  }

  // Attach inline keyboard for actionable tool results
  if (pendingKeyboard && messageId && !agentError) {
    try {
      await ctx.api.editMessageReplyMarkup(ctx.chat!.id, messageId, {
        reply_markup: pendingKeyboard,
      });
    } catch {
      // Non-fatal: keyboard is a convenience feature
    }
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
}
