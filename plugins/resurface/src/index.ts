import type { EchosPlugin, PluginContext } from '@echos/core';
import type { Job } from 'bullmq';
import { resurfaceNotes, formatSurfacedNote } from './resurfacer.js';
import { createGetResurfacedTool } from './tools/get-resurfaced.js';

const DEFAULT_LIMIT = 3;

const plugin: EchosPlugin = {
  name: 'resurface',
  description: 'Resurfaces forgotten notes via spaced repetition and on-this-day discovery',
  version: '0.1.0',

  setup(context: PluginContext) {
    return {
      tools: [createGetResurfacedTool(context)],
      jobs: [
        {
          type: 'resurface',
          description: 'Resurfaces notes from your knowledge base and broadcasts them',
          processor: async (_job: Job, config?: Record<string, unknown>) => {
            const { sqlite, getNotificationService, logger } = context;

            logger.info('Starting knowledge resurfacing');

            const limit =
              config?.['limit'] != null &&
              Number.isFinite(Number(config['limit'])) &&
              Number(config['limit']) > 0
                ? Math.min(Number(config['limit']), 10)
                : DEFAULT_LIMIT;

            const mode =
              config?.['mode'] === 'forgotten' ||
              config?.['mode'] === 'on_this_day' ||
              config?.['mode'] === 'mix'
                ? (config['mode'] as 'forgotten' | 'on_this_day' | 'mix')
                : 'mix';

            const notes = resurfaceNotes(sqlite, { limit, mode });

            if (notes.length === 0) {
              logger.info('No notes to resurface');
              return;
            }

            const header = `🔮 **Your Knowledge, Revisited**\n\n`;
            const body = notes.map(formatSurfacedNote).join('\n\n');
            const message = header + body;

            const notificationService = getNotificationService();
            await notificationService.broadcast(message);
            logger.info({ count: notes.length }, 'Resurfacing notification sent');
          },
        },
      ],
    };
  },
};

export default plugin;
