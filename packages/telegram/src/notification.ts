import type { Bot } from 'grammy';
import type { Logger } from 'pino';
import type { NotificationService } from '@echos/shared';
import { markdownToHtml } from './streaming.js';

const MAX_TELEGRAM_LENGTH = 4096;
const ELLIPSIS = '...';

/**
 * Split an HTML string into chunks that each fit within Telegram's 4096-character limit.
 * Splits on double-newline paragraph boundaries where possible; truncates oversized paragraphs.
 */
export function chunkMessage(html: string): string[] {
  if (html.length <= MAX_TELEGRAM_LENGTH) return [html];

  const chunks: string[] = [];
  const paragraphs = html.split('\n\n');
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

      const chunks = chunkMessage(markdownToHtml(text));
      for (const chunk of chunks) {
        try {
          await bot.api.sendMessage(userId, chunk, { parse_mode: 'HTML' });
        } catch (err) {
          logger.error({ err, userId }, 'Failed to send Telegram notification');
        }
      }
    },

    async broadcast(text: string): Promise<void> {
      const chunks = chunkMessage(markdownToHtml(text));
      for (const userId of allowedUserIds) {
        for (const chunk of chunks) {
          try {
            await bot.api.sendMessage(userId, chunk, { parse_mode: 'HTML' });
          } catch (err) {
            logger.error({ err, userId }, 'Failed to broadcast Telegram notification');
          }
        }
      }
    },
  };
}
