import type { EchosPlugin, PluginContext } from '@echos/core';
import { createEchosAgent } from '@echos/core';
import type { AgentEvent } from '@mariozechner/pi-agent-core';
import type { Job } from 'bullmq';

const DIGEST_PROMPT = `Generate a daily digest summary for today.

Instructions:
1. Use list_notes to find notes created or updated recently (last 24 hours)
2. Use listReminders to check for upcoming or overdue reminders
3. Compose a concise, well-formatted digest with sections for:
   - New/updated notes summary
   - Upcoming reminders and overdue items
   - Any patterns or connections you notice

Keep the digest brief and actionable. Use Markdown formatting.
If there is no recent activity, say so briefly.`;

const plugin: EchosPlugin = {
  name: 'digest',
  description: 'Generates an AI digest of recent notes and reminders',
  version: '0.1.0',

  setup(context: PluginContext) {
    return {
      tools: [],
      jobs: [
        {
          type: 'digest',
          description: 'Generates an AI digest and broadcasts it',
          processor: async (_job: Job, config?: Record<string, unknown>) => {
            const { getAgentDeps, getNotificationService, logger } = context;

            logger.info('Starting digest generation');

            const agent = createEchosAgent(getAgentDeps());
            const notificationService = getNotificationService();

            let textBuffer = '';
            const unsubscribe = agent.subscribe((event: AgentEvent) => {
              if (event.type === 'message_update' && 'assistantMessageEvent' in event) {
                const ame = event.assistantMessageEvent;
                if (ame.type === 'text_delta') {
                  textBuffer += ame.delta;
                }
              }
            });

            try {
              const customPrompt = config?.['prompt'] ? String(config['prompt']) : DIGEST_PROMPT;
              await agent.prompt(customPrompt);
            } finally {
              unsubscribe();
            }

            if (textBuffer.trim()) {
              const message = `*Daily Digest*\n\n${textBuffer.trim()}`;
              await notificationService.broadcast(message);
              logger.info({ length: textBuffer.length }, 'Digest sent');
            } else {
              logger.warn('Digest generation produced no output');
            }
          },
        },
      ],
    };
  },
};

export default plugin;
