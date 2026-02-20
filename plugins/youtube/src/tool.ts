import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { v4 as uuidv4 } from 'uuid';
import type { NoteMetadata } from '@echos/shared';
import type { PluginContext } from '@echos/core';
import { categorizeContent, type ProcessingMode } from '@echos/core';
import { processYoutube, type ProxyConfig } from './processor.js';

const schema = Type.Object({
  url: Type.String({ description: 'YouTube video URL' }),
  tags: Type.Optional(Type.Array(Type.String(), { description: 'Tags for the video' })),
  category: Type.Optional(Type.String({ description: 'Category' })),
  autoCategorize: Type.Optional(
    Type.Boolean({
      description: 'Automatically categorize using AI (default: false)',
      default: false,
    }),
  ),
  processingMode: Type.Optional(
    Type.Union([Type.Literal('lightweight'), Type.Literal('full')], {
      description:
        'AI processing mode: "lightweight" (category+tags) or "full" (includes summary, gist, key points). Only used if autoCategorize is true.',
      default: 'full',
    }),
  ),
});

type Params = Static<typeof schema>;

export function createSaveYoutubeTool(context: PluginContext): AgentTool<typeof schema> {
  const openaiApiKey = context.config['openaiApiKey'] as string | undefined;
  const proxyUsername = context.config['webshareProxyUsername'] as string | undefined;
  const proxyPassword = context.config['webshareProxyPassword'] as string | undefined;
  const proxyConfig: ProxyConfig =
    proxyUsername && proxyPassword
      ? { username: proxyUsername, password: proxyPassword }
      : undefined;

  return {
    name: 'save_youtube',
    label: 'Save YouTube',
    description:
      'Save a YouTube video transcript. Extracts captions and saves as a note. Optionally auto-categorize with AI.',
    parameters: schema,
    execute: async (_toolCallId, params: Params, _signal, onUpdate) => {
      onUpdate?.({
        content: [{ type: 'text', text: `Fetching transcript for ${params.url}...` }],
        details: { phase: 'fetching' },
      });

      const processed = await processYoutube(params.url, context.logger, openaiApiKey, proxyConfig);

      const now = new Date().toISOString();
      const id = uuidv4();

      let category = params.category ?? 'videos';
      let tags = params.tags ?? [];
      let gist: string | undefined;

      // Auto-categorize if requested and API key available
      if (params.autoCategorize && context.config.anthropicApiKey) {
        onUpdate?.({
          content: [{ type: 'text', text: 'Categorizing video transcript with AI...' }],
          details: { phase: 'categorizing' },
        });

        try {
          const mode: ProcessingMode = params.processingMode ?? 'full';
          const result = await categorizeContent(
            processed.title,
            processed.content,
            mode,
            context.config.anthropicApiKey as string,
            context.logger,
            (message) =>
              onUpdate?.({
                content: [{ type: 'text', text: message }],
                details: { phase: 'categorizing' },
              }),
            context.config.defaultModel as string,
          );

          category = result.category;
          tags = result.tags;

          if ('gist' in result) {
            gist = result.gist;
          }

          context.logger.info({ category, tags, mode }, 'YouTube video auto-categorized');
        } catch (error) {
          context.logger.error({ error }, 'Auto-categorization failed, using defaults');
        }
      }

      const metadata: NoteMetadata = {
        id,
        type: 'youtube',
        title: processed.title,
        created: now,
        updated: now,
        tags,
        links: [],
        category,
        sourceUrl: params.url,
        status: 'saved',
        inputSource: 'url',
      };
      if (gist) metadata.gist = gist;

      const filePath = context.markdown.save(metadata, processed.content);
      context.sqlite.upsertNote(metadata, processed.content, filePath);

      if (processed.embedText) {
        try {
          const vector = await context.generateEmbedding(processed.embedText);
          await context.vectorDb.upsert({
            id,
            text: processed.embedText,
            vector,
            type: 'youtube',
            title: processed.title,
          });
        } catch {
          // Non-fatal
        }
      }

      let responseText = `**YouTube video saved successfully!**\n\n`;
      responseText += `**Title:** ${processed.title}\n`;
      responseText += `**ID:** ${id}\n`;
      responseText += `**Category:** ${category}\n`;
      responseText += `**Tags:** [${tags.join(', ')}]\n`;
      responseText += `**Transcript length:** ${processed.content.length} characters\n`;
      if (gist) {
        responseText += `**Gist:** ${gist}\n`;
      }
      responseText += `\n---\n\n**Full Transcript:**\n\n${processed.content}`;

      return {
        content: [
          {
            type: 'text' as const,
            text: responseText,
          },
        ],
        details: {
          id,
          filePath,
          title: processed.title,
          category,
          tags,
          content: processed.content,
          transcript: processed.content,
          metadata,
          gist,
        },
      };
    },
  };
}
