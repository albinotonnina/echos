import type { Bot } from 'grammy';
import type { Logger } from 'pino';
import type { NotificationService } from '@echos/shared';
import { markdownToHtml } from './streaming.js';

const MAX_TELEGRAM_LENGTH = 4096;
const ELLIPSIS = '...';

/**
 * Split a raw markdown string into chunks that each fit within Telegram's 4096-character limit.
 * Splits on double-newline paragraph boundaries where possible; truncates oversized paragraphs.
 * Operates on raw markdown (before HTML conversion) to prevent slicing inside HTML tags or entities.
 */
export function chunkMessage(markdown: string): string[] {
  if (markdown.length <= MAX_TELEGRAM_LENGTH) return [markdown];

  const chunks: string[] = [];
  const paragraphs = markdown.split('\n\n');
  let current = '';

  for (const para of paragraphs) {
    const segment = para.trim();
    if (!segment) continue;

    const candidate = current ? `${current}\n\n${segment}` : segment;

    if (candidate.length <= MAX_TELEGRAM_LENGTH) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current =
        segment.length > MAX_TELEGRAM_LENGTH
          ? `${segment.slice(0, MAX_TELEGRAM_LENGTH - ELLIPSIS.length)}${ELLIPSIS}`
          : segment;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

async function sendMarkdownChunks(
  bot: Bot,
  userId: number,
  chunks: string[],
  logger: Logger,
  errorMsg: string,
): Promise<void> {
  for (const chunk of chunks) {
    const html = markdownToHtml(chunk);
    try {
      await bot.api.sendMessage(userId, html, { parse_mode: 'HTML' });
    } catch (htmlErr) {
      // Fallback: retry as plain text without parse_mode to avoid silently losing notifications
      logger.warn({ err: htmlErr, userId }, 'HTML send failed, retrying as plain text');
      try {
        await bot.api.sendMessage(userId, chunk);
      } catch (fallbackErr) {
        logger.error({ err: fallbackErr, userId }, errorMsg);
      }
    }
  }
}

export interface TelegramNotificationOptions {
  bot: Bot;
  allowedUserIds: number[];
  logger: Logger;
}

export function createTelegramNotificationService(
  options: TelegramNotificationOptions,
): NotificationService {
  const { bot, allowedUserIds, logger } = options;

  return {
    async sendMessage(userId: number, text: string): Promise<void> {
      if (!allowedUserIds.includes(userId)) {
        logger.warn({ userId }, 'Notification blocked: user not in allowedUserIds');
        return;
      }

      const chunks = chunkMessage(text);
      await sendMarkdownChunks(bot, userId, chunks, logger, 'Failed to send Telegram notification');
    },

    async broadcast(text: string): Promise<void> {
      const chunks = chunkMessage(text);
      for (const userId of allowedUserIds) {
        await sendMarkdownChunks(
          bot,
          userId,
          chunks,
          logger,
          'Failed to broadcast Telegram notification',
        );
      }
    },
  };
}
