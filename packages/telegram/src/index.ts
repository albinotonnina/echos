import { Bot } from 'grammy';
import type { Logger } from 'pino';
import type { Config, InterfaceAdapter } from '@echos/shared';
import type { AgentDeps } from '@echos/core';
import { createAuthMiddleware, createRateLimitMiddleware, createErrorHandler } from './middleware/index.js';
import { getOrCreateSession, clearAllSessions } from './session.js';
import { streamAgentResponse } from './streaming.js';

export interface TelegramAdapterOptions {
  config: Config;
  agentDeps: AgentDeps;
  logger: Logger;
}

export function createTelegramAdapter(options: TelegramAdapterOptions): InterfaceAdapter {
  const { config, agentDeps, logger } = options;
  const bot = new Bot(config.telegramBotToken);

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

  // Handle all text messages via agent
  bot.on('message:text', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const agent = getOrCreateSession(userId, agentDeps);
    await streamAgentResponse(agent, ctx.message.text, ctx);
  });

  return {
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
