import type { Bot } from 'grammy';
import type { Logger } from 'pino';
import type { Config } from '@echos/shared';
import type { AgentDeps } from '@echos/core';
import { createUserMessage } from '@echos/core';
import { getOrCreateSession } from './session.js';
import { streamAgentResponse } from './streaming.js';
import { handleVoiceMessage } from './voice.js';
import { handlePhotoMessage } from './photo.js';
import { mkdir, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

export interface MessageDeps {
  agentDeps: AgentDeps;
  config: Config;
  logger: Logger;
}

export function registerMessageHandlers(bot: Bot, deps: MessageDeps): void {
  const { agentDeps, config, logger } = deps;

  // Handle document messages (PDF, CSV)
  const MAX_DOCUMENT_SIZE = 20 * 1024 * 1024; // 20 MB
  const DOWNLOAD_TIMEOUT_MS = 30_000;
  const SUPPORTED_EXTS = new Set<string>([
    '.pdf',
    '.csv',
  ]);

  bot.on('message:document', async (ctx) => {
    const doc = ctx.message?.document;
    if (!doc) return;

    const userId = ctx.from?.id;
    if (!userId) return;

    const file = await ctx.api.getFile(doc.file_id);

    if (!file.file_path) {
      await ctx.reply('Could not retrieve the file from Telegram. Please try sending it again.');
      return;
    }

    const fileName = doc.file_name || file.file_path.split('/').pop() || 'unknown';
    const ext = extname(fileName).toLowerCase();

    if (!SUPPORTED_EXTS.has(ext)) {
      await ctx.reply('Unsupported file type. Supported: PDF, CSV.');
      return;
    }

    if (doc.file_size !== undefined && doc.file_size > MAX_DOCUMENT_SIZE) {
      await ctx.reply('File is too large. Maximum supported size is 20 MB.');
      return;
    }

    if (config.telegramReactions) await ctx.react('👀').catch(() => undefined);

    let tmpFilePath: string | undefined;
    try {
      const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;

      const tmpDir = join(tmpdir(), 'echos-docs');
      await mkdir(tmpDir, { recursive: true });

      const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      tmpFilePath = join(tmpDir, `${randomUUID().substring(0, 8)}-${safeFileName}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
      try {
        const response = await fetch(fileUrl, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Failed to download: HTTP ${response.status}`);
        }
        if (!response.body) {
          throw new Error('No response body');
        }
        // Stream directly to disk to avoid buffering the whole file in memory
        await pipeline(
          Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
          createWriteStream(tmpFilePath),
        );
      } finally {
        clearTimeout(timeout);
      }

      const agent = getOrCreateSession(userId, agentDeps);

      const instruction =
        `The user sent a document: "${fileName}" (type: ${ext}). ` +
        `The file has been downloaded to a temporary location on the server; ` +
        `please process this document and extract its contents as a knowledge note.`;

      await streamAgentResponse(agent, instruction, ctx, config.telegramReactions);
    } catch (error) {
      logger.error({ err: error, fileName }, 'Failed to process document');
      await ctx.reply(`Sorry, I couldn't process "${fileName}". Please try again later.`);
    } finally {
      if (tmpFilePath) {
        unlink(tmpFilePath).catch(() => undefined);
      }
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

    if (config.telegramReactions) await ctx.react('👀').catch(() => undefined);
    await streamAgentResponse(agent, ctx.message.text, ctx, config.telegramReactions);
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
    await handleVoiceMessage(ctx, agent, config.openaiApiKey, logger, config.whisperLanguage, config.telegramReactions);
  });

  // Handle photo messages
  bot.on('message:photo', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    if (config.telegramReactions) await ctx.react('👀').catch(() => undefined);
    const agent = getOrCreateSession(userId, agentDeps);
    await handlePhotoMessage(ctx, agent, logger, config.telegramReactions);
  });
}
