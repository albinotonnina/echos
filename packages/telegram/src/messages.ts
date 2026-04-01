import type { Bot } from 'grammy';
import type { Logger } from 'pino';
import type { Config } from '@echos/shared';
import type { AgentDeps } from '@echos/core';
import { createUserMessage } from '@echos/core';
import { getOrCreateSession } from './session.js';
import { streamAgentResponse } from './streaming.js';
import { handleVoiceMessage } from './voice.js';
import { handlePhotoMessage } from './photo.js';

export interface MessageDeps {
  agentDeps: AgentDeps;
  config: Config;
  logger: Logger;
}

export function registerMessageHandlers(bot: Bot, deps: MessageDeps): void {
  const { agentDeps, config, logger } = deps;

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

    if (config.telegramReactions) await ctx.react('👀').catch(() => undefined);
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

    if (config.telegramReactions) await ctx.react('🤗').catch(() => undefined);
    const agent = getOrCreateSession(userId, agentDeps);
    await handleVoiceMessage(ctx, agent, config.openaiApiKey, logger, config.whisperLanguage);
  });

  // Handle photo messages
  bot.on('message:photo', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    if (config.telegramReactions) await ctx.react('👀').catch(() => undefined);
    const agent = getOrCreateSession(userId, agentDeps);
    await handlePhotoMessage(ctx, agent, logger);
  });
}
