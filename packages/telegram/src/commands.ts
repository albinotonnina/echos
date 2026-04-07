import type { Bot, Context } from 'grammy';
import type { Logger } from 'pino';
import type { AgentDeps } from '@echos/core';
import type { Config } from '@echos/shared';
import {
  computeSessionUsage,
  createUserMessage,
  resolveModel,
  MODEL_PRESETS,
  type ModelPreset,
} from '@echos/core';
import { getVersion } from '@echos/shared';
import { getSession, clearSession } from './session.js';

export interface CommandDeps {
  agentDeps: AgentDeps;
  config: Config;
  logger: Logger;
}

export function registerCommands(bot: Bot, deps: CommandDeps): void {
  const { agentDeps } = deps;

  // /start command
  bot.command('start', async (ctx: Context) => {
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
  bot.command('version', async (ctx: Context) => {
    const version = getVersion();
    await ctx.reply(`EchOS v${version}`);
  });

  // /reset command - clear agent session
  bot.command('reset', async (ctx: Context) => {
    const userId = ctx.from?.id;
    if (userId) {
      clearSession(userId);
      await ctx.reply('Session cleared. Starting fresh.');
    }
  });

  // /usage command - show session usage stats
  bot.command('usage', async (ctx: Context) => {
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
  bot.command('model', async (ctx: Context) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const raw = typeof ctx.match === 'string' ? ctx.match : undefined;
    const preset = raw?.toLowerCase().trim() as ModelPreset | '' | undefined;

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

    agent.state.model = resolveModel(modelSpec);
    await ctx.reply(`✅ Switched to ${preset}: ${agent.state.model.id}`);
  });

  // /followup command — queue work to run after the current agent turn finishes
  bot.command('followup', async (ctx: Context) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const text = typeof ctx.match === 'string' ? ctx.match : undefined;
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
}
