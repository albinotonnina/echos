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
import { getVersion } from '@echos/shared';
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
import { decodeCallback } from './keyboards.js';

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

  // /version command - show running EchOS version
  bot.command('version', async (ctx) => {
    const version = getVersion();
    await ctx.reply(`EchOS v${version}`);
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

  // Handle inline keyboard button presses
  bot.on('callback_query:data', async (ctx) => {
    const parsed = decodeCallback(ctx.callbackQuery.data);
    if (!parsed) {
      await ctx.answerCallbackQuery({ text: 'Unknown action.' });
      return;
    }

    const { action, id } = parsed;
    const { sqlite, markdown } = agentDeps;

    // Phase 1: execute the storage action and answer the callback query.
    // These are kept in the same try/catch so failures here don't produce
    // a double-answer attempt in Phase 2.
    let answered = false;
    try {
      if (action === 'mr' || action === 'ar') {
        const status = action === 'mr' ? 'read' : 'archived';
        const note = sqlite.getNote(id);
        if (!note) {
          await ctx.answerCallbackQuery({ text: 'Note not found.' });
          answered = true;
          return;
        }
        sqlite.updateNoteStatus(id, status);
        try { markdown.update(note.filePath, { status }); } catch { /* non-fatal */ }
        const verb = action === 'mr' ? 'read' : 'archived';
        await ctx.answerCallbackQuery({ text: `Marked as ${verb}.` });
        answered = true;
      } else if (action === 'cr') {
        const reminder = sqlite.getReminder(id);
        if (!reminder) {
          await ctx.answerCallbackQuery({ text: 'Reminder not found.' });
          answered = true;
          return;
        }
        sqlite.upsertReminder({
          ...reminder,
          completed: true,
          updated: new Date().toISOString(),
        });
        // Telegram answerCallbackQuery text limit is 200 chars — truncate title to be safe
        const titleShort = reminder.title.length > 180
          ? reminder.title.slice(0, 179) + '\u2026'
          : reminder.title;
        await ctx.answerCallbackQuery({ text: `Completed: ${titleShort}` });
        answered = true;
      }
    } catch (err) {
      logger.error({ err, action, id }, 'Callback query error');
      if (!answered) {
        await ctx.answerCallbackQuery({ text: 'Something went wrong.' }).catch(() => undefined);
      }
      return;
    }

    // Phase 2: remove the pressed button from the keyboard.
    // Isolated in its own try/catch so a markup-edit failure never triggers
    // a second answerCallbackQuery call (Telegram only allows one per query).
    try {
      const msg = ctx.callbackQuery.message;
      if (msg) {
        const existingMarkup = msg.reply_markup;
        if (existingMarkup?.inline_keyboard) {
          const callbackData = ctx.callbackQuery.data;
          const filtered = existingMarkup.inline_keyboard
            .map((row) => row.filter((btn) => !('callback_data' in btn) || btn.callback_data !== callbackData))
            .filter((row) => row.length > 0);
          await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: filtered.length > 0 ? filtered : [] } });
        }
      }
    } catch {
      // Non-fatal: keyboard cleanup is best-effort
    }
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
    await handleVoiceMessage(ctx, agent, config.openaiApiKey, logger, config.whisperLanguage);
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
