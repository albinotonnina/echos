import { Bot } from 'grammy';
import type { Logger } from 'pino';
import type { Config, InterfaceAdapter, NotificationService } from '@echos/shared';
import type { AgentDeps } from '@echos/core';
import {
  computeSessionUsage,
  createUserMessage,
  resolveModel,
  MODEL_PRESETS,
  type ModelPreset,
} from '@echos/core';
import {
  createAuthMiddleware,
  createRateLimitMiddleware,
  createErrorHandler,
} from './middleware/index.js';
import { getOrCreateSession, getSession, clearAllSessions } from './session.js';
import { streamAgentResponse } from './streaming.js';
import { createTelegramNotificationService } from './notification.js';
import { handleVoiceMessage } from './voice.js';
import { handlePhotoMessage } from './photo.js';

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
  if (!config.telegramBotToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required when enableTelegram=true');
  }
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
      "Welcome to EchOS! I'm your personal knowledge assistant.\n\n" +
        "Start by telling me about yourself — what you do, what you're working on, what interests you. " +
        'The more I know about you, the better I can organize your knowledge and create content in your voice.\n\n' +
        'You can:\n' +
        '- Send text to create notes\n' +
        '- Send URLs to save articles\n' +
        '- Send photos to save and categorize images\n' +
        '- Ask questions about your knowledge\n' +
        '- Send voice messages to transcribe and process them\n' +
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
    const costStr = usage.totalCost < 0.01 ? `<$0.01` : `$${usage.totalCost.toFixed(2)}`;

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

  // /model command — switch model preset for the current session
  bot.command('model', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const preset = ctx.match?.toLowerCase().trim() as ModelPreset | '' | undefined;

    if (!preset) {
      const agent = getSession(userId);
      const currentModel = agent?.state.model.id ?? '(no session)';
      const presets = agentDeps.modelPresets ?? {};
      const available = [
        `fast: ${agentDeps.modelId ?? MODEL_PRESETS.fast}`,
        `balanced: ${presets.balanced ?? MODEL_PRESETS.balanced}`,
        `deep: ${presets.deep ?? MODEL_PRESETS.deep}`,
      ].join('\n  ');
      await ctx.reply(
        `Current model: ${currentModel}\n\nAvailable presets:\n  ${available}\n\nUsage: /model fast|balanced|deep`,
      );
      return;
    }

    if (!['fast', 'balanced', 'deep'].includes(preset)) {
      await ctx.reply('Unknown preset. Use: fast | balanced | deep');
      return;
    }

    const agent = getSession(userId);
    if (!agent) {
      await ctx.reply('No active session. Send a message first.');
      return;
    }

    const presets = agentDeps.modelPresets ?? {};
    const modelSpec =
      preset === 'fast'
        ? (agentDeps.modelId ?? MODEL_PRESETS.fast)
        : preset === 'balanced'
          ? (presets.balanced ?? MODEL_PRESETS.balanced)
          : (presets.deep ?? MODEL_PRESETS.deep);

    agent.setModel(resolveModel(modelSpec));
    await ctx.reply(`✅ Switched to ${preset}: ${agent.state.model.id}`);
  });

  // /followup command — queue work to run after the current agent turn finishes
  bot.command('followup', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const text = ctx.match;
    if (!text) {
      await ctx.reply('Usage: /followup <message>');
      return;
    }

    const agent = getSession(userId);
    if (!agent) {
      await ctx.reply('No active session. Send a message first.');
      return;
    }

    agent.followUp(createUserMessage(text));
    await ctx.reply('📋 Queued — will run after the current task finishes.');
  });

  // Handle all text messages via agent
  bot.on('message:text', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const agent = getOrCreateSession(userId, agentDeps);

    // If the agent is mid-run, steer it with the new message instead of queuing a new turn
    if (agent.state.isStreaming) {
      agent.steer(createUserMessage(ctx.message.text));
      await ctx.reply('↩️ Redirecting...');
      return;
    }

    await ctx.react('👀').catch(() => undefined);
    await streamAgentResponse(agent, ctx.message.text, ctx);
  });

  // Handle voice messages via Whisper transcription
  bot.on('message:voice', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    if (!config.openaiApiKey) {
      await ctx.reply('Voice messages require OpenAI API key configuration.');
      return;
    }

    await ctx.react('🤗').catch(() => undefined);
    const agent = getOrCreateSession(userId, agentDeps);
    await handleVoiceMessage(ctx, agent, config.openaiApiKey, logger);
  });

  // Handle photo messages
  bot.on('message:photo', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    await ctx.react('👀').catch(() => undefined);
    const agent = getOrCreateSession(userId, agentDeps);
    await handlePhotoMessage(ctx, agent, logger);
  });

  return {
    notificationService,

    async start(): Promise<void> {
      logger.info('Starting Telegram bot...');
      // Drop pending updates to prevent stale /start commands from being processed
      // when the bot reconnects after being offline (e.g., user cleared messages)
      bot.start({
        onStart: () => logger.info('Telegram bot started'),
        drop_pending_updates: true,
      });
    },

    async stop(): Promise<void> {
      logger.info('Stopping Telegram bot...');
      clearAllSessions();
      bot.stop();
    },
  };
}
