import type { Bot } from 'grammy';
import type { Logger } from 'pino';
import type { NotificationService } from '@echos/shared';
import { markdownToHtml } from './streaming.js';

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

      try {
        await bot.api.sendMessage(userId, markdownToHtml(text), { parse_mode: 'HTML' });
      } catch (err) {
        logger.error({ err, userId }, 'Failed to send Telegram notification');
      }
    },

    async broadcast(text: string): Promise<void> {
      for (const userId of allowedUserIds) {
        try {
          await bot.api.sendMessage(userId, markdownToHtml(text), { parse_mode: 'HTML' });
        } catch (err) {
          logger.error({ err, userId }, 'Failed to broadcast Telegram notification');
        }
      }
    },
  };
}
