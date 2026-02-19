import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from 'grammy';
import type { Agent } from '@mariozechner/pi-agent-core';
import type { Logger } from 'pino';
import { streamAgentResponse } from './streaming.js';

const MAX_PHOTO_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

export async function handlePhotoMessage(
  ctx: Context,
  agent: Agent,
  logger: Logger,
): Promise<void> {
  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) return;

  // Get the largest photo (last in array)
  const photo = photos[photos.length - 1];
  if (!photo) return;

  if (photo.file_size !== undefined && photo.file_size > MAX_PHOTO_SIZE_BYTES) {
    await ctx.reply('Photo is too large. Maximum size is 20MB.');
    return;
  }

  const caption = ctx.message?.caption || '';
  const statusMsg = await ctx.reply('📷 Processing your photo...');
  const tempFilePath = join(tmpdir(), `photo-${randomUUID()}.jpg`);

  try {
    const file = await ctx.api.getFile(photo.file_id);
    const filePath = file.file_path;
    if (!filePath) {
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, '❌ Failed to retrieve photo.');
      return;
    }

    const token = ctx.api.token;
    const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let photoBuffer: Buffer;
    try {
      const response = await fetch(fileUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Failed to download photo: ${response.statusText}`);
      }
      photoBuffer = Buffer.from(await response.arrayBuffer());
    } finally {
      clearTimeout(timeout);
    }

    await writeFile(tempFilePath, photoBuffer);

    logger.info({ caption, size: photoBuffer.length, fileUrl }, 'Photo message received');

    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `📷 Saving photo${caption ? ` with caption: "${caption}"` : ''}...`,
    );

    // Build instruction for the agent to use save_image tool
    // We'll pass the Telegram file URL which the tool can download
    let instruction = `Use the save_image tool to save an image from this URL: ${fileUrl}`;
    if (caption) {
      instruction += `, with caption: "${caption}"`;
    }
    instruction += `, and autoCategorize set to true.`;

    await streamAgentResponse(agent, instruction, ctx);

  } catch (err) {
    logger.error({ err }, 'Failed to process photo message');
    await ctx.api.setMessageReaction(
      ctx.chat!.id,
      ctx.message!.message_id,
      [{ type: 'emoji', emoji: '😱' }],
    ).catch(() => undefined);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      '❌ Failed to process your photo. Please try again.',
    );
  } finally {
    await unlink(tempFilePath).catch(() => undefined);
  }
}
