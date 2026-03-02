import type { EchosPlugin, PluginContext } from '@echos/core';
import type { Job } from 'bullmq';
import { createJournalTool } from './tools/journal.js';
import { createReflectTool } from './tools/reflect.js';

const DEFAULT_PROMPT =
  'Time to reflect. How was your day? What are you thinking about right now? Take a moment to write it down.';
const MAX_PROMPT_LENGTH = 1000;

const plugin: EchosPlugin = {
  name: 'journal',
  description: 'Dedicated journaling, AI reflection, and daily journal prompts',
  version: '0.1.0',

  setup(context: PluginContext) {
    return {
      tools: [createJournalTool(context), createReflectTool(context)],
      jobs: [
        {
          type: 'journal_prompt',
          description: 'Sends a daily journaling prompt via notification',
          processor: async (_job: Job, config?: Record<string, unknown>) => {
            const { getNotificationService, logger } = context;

            const rawPrompt = typeof config?.['prompt'] === 'string' ? config['prompt'].trim() : '';
            const prompt =
              rawPrompt.length > 0 && rawPrompt.length <= MAX_PROMPT_LENGTH
                ? rawPrompt
                : DEFAULT_PROMPT;

            try {
              const notificationService = getNotificationService();
              await notificationService.broadcast(`📓 **Journal Prompt**\n\n${prompt}`);
              logger.info('Journal prompt sent');
            } catch (err) {
              logger.warn({ err }, 'Failed to send journal prompt');
            }
          },
        },
      ],
    };
  },
};

export default plugin;
