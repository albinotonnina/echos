import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { NoteMetadata } from '@echos/shared';
import type { PluginContext } from '@echos/core';
import { categorizeContent, type ProcessingMode } from '@echos/core';
import { processImage, saveImageToDisk } from './processor.js';

const schema = Type.Object({
  imageUrl: Type.Optional(Type.String({ description: 'URL of the image to save', format: 'uri' })),
  imageData: Type.Optional(Type.String({ description: 'Base64-encoded image data' })),
  title: Type.Optional(Type.String({ description: 'Title for the image' })),
  caption: Type.Optional(Type.String({ description: 'Caption or description for the image' })),
  tags: Type.Optional(Type.Array(Type.String(), { description: 'Tags for the image' })),
  category: Type.Optional(Type.String({ description: 'Category for the image' })),
  autoCategorize: Type.Optional(
    Type.Boolean({
      description: 'Automatically categorize using AI (default: false)',
      default: false,
    }),
  ),
  processingMode: Type.Optional(
    Type.Union([Type.Literal('lightweight'), Type.Literal('full')], {
      description: 'AI processing mode: "lightweight" (category+tags) or "full" (includes summary, gist, key points). Only used if autoCategorize is true.',
      default: 'lightweight',
    }),
  ),
});

type Params = Static<typeof schema>;

export function createSaveImageTool(context: PluginContext): AgentTool<typeof schema> {
  return {
    name: 'save_image',
    label: 'Save Image',
    description:
      'Save an image to the knowledge base. Provide either imageUrl or imageData. Extracts metadata (dimensions, format, EXIF).',
    parameters: schema,
    execute: async (_toolCallId, params: Params, _signal, onUpdate) => {
      if (!params.imageUrl && !params.imageData) {
        throw new Error('Either imageUrl or imageData must be provided');
      }

      onUpdate?.({
        content: [{ type: 'text', text: 'Processing image...' }],
        details: { phase: 'processing' },
      });

      // Convert base64 to buffer if needed
      let input: string | Buffer;
      if (params.imageData) {
        input = Buffer.from(params.imageData, 'base64');
      } else {
        input = params.imageUrl!;
      }

      const processed = await processImage(input, context.logger);

      const now = new Date().toISOString();
      const id = uuidv4();

      let category = params.category ?? 'photos';
      let tags = params.tags ?? [];
      let title = params.title ?? processed.title;
      let gist: string | undefined;

      // Build description from caption or metadata
      let content = params.caption ?? processed.content;

      // Auto-categorize if requested
      if (params.autoCategorize && context.config.anthropicApiKey) {
        onUpdate?.({
          content: [{ type: 'text', text: 'Categorizing image with AI...' }],
          details: { phase: 'categorizing' },
        });

        try {
          const mode: ProcessingMode = params.processingMode ?? 'lightweight';
          const textForCategorization = `${title}\n${content}\n${params.caption ?? ''}`;

          const result = await categorizeContent(
            title,
            textForCategorization,
            mode,
            context.config.anthropicApiKey as string,
            context.logger,
            (message: string) =>
              onUpdate?.({
                content: [{ type: 'text', text: message }],
                details: { phase: 'categorizing' },
              }),
          );

          category = result.category;
          tags = result.tags;

          if ('gist' in result) {
            gist = result.gist;
          }

          context.logger.info({ category, tags, mode }, 'Image auto-categorized');
        } catch (error) {
          context.logger.error({ error }, 'Auto-categorization failed, using defaults');
        }
      }

      // Save image to disk
      const knowledgeDir = context.config.knowledgeDir;
      if (!knowledgeDir) {
        throw new Error('knowledgeDir is not configured');
      }

      const imageDir = join(knowledgeDir, 'image', category);
      mkdirSync(imageDir, { recursive: true });

      const imagePath = await saveImageToDisk(processed.buffer, knowledgeDir, category, processed.localPath);

      // Append image reference to content
      const imageRef = `![${title}](../../image/${category}/${processed.localPath})`;
      const fullContent = `${content}\n\n${imageRef}`;

      const metadata: NoteMetadata = {
        id,
        type: 'image',
        title,
        created: now,
        updated: now,
        tags,
        links: [],
        category,
        status: 'saved',
        inputSource: 'image',
        imagePath,
        ...(params.imageUrl ? { imageUrl: params.imageUrl } : {}),
        imageMetadata: JSON.stringify(processed.imageMetadata),
      };

      if (gist) metadata.gist = gist;

      // Save markdown note
      const filePath = context.markdown.save(metadata, fullContent);
      context.sqlite.upsertNote(metadata, fullContent, filePath);

      // Embed for vector search
      const embedText = `${title}\n${content}\n${params.caption ?? ''}`;
      if (embedText.trim()) {
        try {
          const vector = await context.generateEmbedding(embedText);
          await context.vectorDb.upsert({
            id,
            text: embedText,
            vector,
            type: 'image',
            title,
          });
        } catch {
          // Non-fatal
        }
      }

      const imgMeta = processed.imageMetadata;
      let responseText = `Saved image "${title}" to your knowledge base (id: ${id})\n`;
      responseText += `Format: ${imgMeta.format.toUpperCase()}\n`;
      responseText += `Dimensions: ${imgMeta.width}x${imgMeta.height}\n`;
      responseText += `Size: ${(imgMeta.size / 1024).toFixed(2)} KB\n`;
      responseText += `Category: ${category}\n`;
      responseText += `Tags: [${tags.join(', ')}]\n`;
      responseText += `Status: saved`;
      if (gist) {
        responseText += `\nGist: ${gist}`;
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: responseText,
          },
        ],
        details: { id, filePath, imagePath, title, category, tags },
      };
    },
  };
}
