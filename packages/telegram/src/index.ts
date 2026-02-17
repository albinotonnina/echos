import { Bot } from 'grammy';
import type { Logger } from 'pino';
import type { Config, InterfaceAdapter, NotificationService } from '@echos/shared';
import type { AgentDeps } from '@echos/core';
import { computeSessionUsage } from '@echos/core';
import { createAuthMiddleware, createRateLimitMiddleware, createErrorHandler } from './middleware/index.js';
import { getOrCreateSession, getSession, clearAllSessions } from './session.js';
import { streamAgentResponse } from './streaming.js';
import { createTelegramNotificationService } from './notification.js';

export interface TelegramAdapterOptions {
  config: Config;
  agentDeps: AgentDeps;
  logger: Logger;
}

export interface TelegramAdapter extends InterfaceAdapter {
  notificationService: NotificationService;
}

export function createTelegramAdapter(options: TelegramAdapterOptions): TelegramAdapter {
  const { config, agentDeps, logger } = options;
  const bot = new Bot(config.telegramBotToken);

  const notificationService = createTelegramNotificationService({
    bot,
    allowedUserIds: config.allowedUserIds,
    logger,
  });

  // Middleware chain: error -> auth -> rate limit
  bot.catch(createErrorHandler(logger));
  bot.use(createAuthMiddleware(config.allowedUserIds, logger));
  bot.use(createRateLimitMiddleware());

  // /start command
  bot.command('start', async (ctx) => {
    await ctx.reply(
      'Welcome to EchOS! I\'m your personal knowledge assistant.\n\n' +
      'Just send me a message and I\'ll help you manage your knowledge base.\n\n' +
      'You can:\n' +
      '- Send text to create notes\n' +
      '- Send URLs to save articles\n' +
      '- Ask questions about your knowledge\n' +
      '- Manage reminders and more',
    );
  });

  // /reset command - clear agent session
  bot.command('reset', async (ctx) => {
    const userId = ctx.from?.id;
    if (userId) {
      const { clearSession } = await import('./session.js');
      clearSession(userId);
      await ctx.reply('Session cleared. Starting fresh.');
    }
  });

  // /usage command - show session usage stats
  bot.command('usage', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const agent = getSession(userId);
    if (!agent) {
      await ctx.reply('No active session. Send a message to start one.');
      return;
    }

    const usage = computeSessionUsage(agent);
    const costStr = usage.totalCost < 0.01
      ? `<$0.01`
      : `$${usage.totalCost.toFixed(2)}`;

    await ctx.reply(
      `Session usage:\n` +
      `Messages: ${usage.messageCount}\n` +
      `Input tokens: ${usage.inputTokens.toLocaleString()}\n` +
      `Output tokens: ${usage.outputTokens.toLocaleString()}\n` +
      `Cache read: ${usage.cacheReadTokens.toLocaleString()}\n` +
      `Cache write: ${usage.cacheWriteTokens.toLocaleString()}\n` +
      `Cost: ${costStr}\n` +
      `Context window: ${usage.contextWindowPercent.toFixed(1)}%`,
    );
  });

  // Handle all text messages via agent
  bot.on('message:text', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const agent = getOrCreateSession(userId, agentDeps);
    await streamAgentResponse(agent, ctx.message.text, ctx);
  });

  return {
    notificationService,

    async start(): Promise<void> {
      logger.info('Starting Telegram bot...');
      bot.start({
        onStart: () => logger.info('Telegram bot started'),
      });
    },

    async stop(): Promise<void> {
      logger.info('Stopping Telegram bot...');
      clearAllSessions();
      bot.stop();
    },
  };
}
