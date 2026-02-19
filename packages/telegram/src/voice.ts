import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { writeFile, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import type { Context } from 'grammy';
import type { Agent } from '@mariozechner/pi-agent-core';
import type { Logger } from 'pino';
import OpenAI from 'openai';
import { streamAgentResponse } from './streaming.js';

const MAX_VOICE_DURATION_SECONDS = 600; // 10 minutes
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB — Whisper limit

export async function handleVoiceMessage(
  ctx: Context,
  agent: Agent,
  openaiApiKey: string,
  logger: Logger,
): Promise<void> {
  const voice = ctx.message?.voice;
  if (!voice) return;

  if (voice.duration > MAX_VOICE_DURATION_SECONDS) {
    await ctx.reply('Voice message is too long. Maximum duration is 10 minutes.');
    return;
  }

  if (voice.file_size !== undefined && voice.file_size > MAX_FILE_SIZE_BYTES) {
    await ctx.reply('Voice message file is too large. Maximum size is 25MB.');
    return;
  }

  const statusMsg = await ctx.reply('🎤 Transcribing your voice message...');
  const tempFilePath = join(tmpdir(), `voice-${randomUUID()}.ogg`);

  try {
    const file = await ctx.api.getFile(voice.file_id);
    const filePath = file.file_path;
    if (!filePath) {
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, '❌ Failed to retrieve voice file.');
      return;
    }

    const token = ctx.api.token;
    const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let audioBuffer: Buffer;
    try {
      const response = await fetch(fileUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Failed to download voice file: ${response.statusText}`);
      }
      audioBuffer = Buffer.from(await response.arrayBuffer());
    } finally {
      clearTimeout(timeout);
    }

    await writeFile(tempFilePath, audioBuffer);

    const openai = new OpenAI({ apiKey: openaiApiKey });
    const audioStream = createReadStream(tempFilePath) as unknown as File;
    const transcription = await openai.audio.transcriptions.create({
      file: audioStream,
      model: 'whisper-1',
      response_format: 'text',
    });

    const transcribedText = typeof transcription === 'string' ? transcription.trim() : '';

    if (!transcribedText) {
      await ctx.api.setMessageReaction(
        ctx.chat!.id,
        ctx.message!.message_id,
        [{ type: 'emoji', emoji: '😱' }],
      ).catch(() => undefined);
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        '🎤 Could not transcribe the voice message. Please try again.',
      );
      return;
    }

    const preview = transcribedText.length > 200 ? `${transcribedText.slice(0, 200)}...` : transcribedText;
    logger.info({ preview }, 'Voice message transcribed');

    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `🎤 "${preview}"\n\nProcessing...`,
    );

    await streamAgentResponse(agent, transcribedText, ctx);
  } catch (err) {
    logger.error({ err }, 'Failed to process voice message');
    await ctx.api.setMessageReaction(
      ctx.chat!.id,
      ctx.message!.message_id,
      [{ type: 'emoji', emoji: '😱' }],
    ).catch(() => undefined);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      '❌ Failed to process your voice message. Please try again.',
    );
  } finally {
    await unlink(tempFilePath).catch(() => undefined);
  }
}
