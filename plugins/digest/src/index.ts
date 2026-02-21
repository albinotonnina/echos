import type { EchosPlugin, PluginContext } from '@echos/core';
import { createEchosAgent } from '@echos/core';
import type { AgentEvent } from '@mariozechner/pi-agent-core';
import type { Job } from 'bullmq';

const DEFAULT_LOOKBACK_DAYS = 1;

function buildDigestPrompt(config?: Record<string, unknown>): string {
  if (config?.['prompt']) {
    return String(config['prompt']);
  }

  const rawLookback = Number(config?.['lookbackDays']);
  const lookbackDays =
    config?.['lookbackDays'] != null && Number.isFinite(rawLookback) && rawLookback > 0
      ? rawLookback
      : DEFAULT_LOOKBACK_DAYS;

  const categories: string[] =
    Array.isArray(config?.['categories']) ? (config['categories'] as unknown[]).map(String).filter(Boolean) : [];

  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - lookbackDays);
  const dateFromStr = dateFrom.toISOString();

  const lookbackLabel = lookbackDays === 1 ? 'last day' : `last ${lookbackDays} days`;
  const categoriesClause =
    categories.length > 0
      ? ` Only include notes tagged with: ${categories.join(', ')}.`
      : '';

  return `Generate a daily digest summary for today.

Instructions:
1. Use list_notes with dateFrom="${dateFromStr}" to find notes created or updated in the ${lookbackLabel}.${categoriesClause}
2. Use listReminders to check for upcoming or overdue reminders
3. Compose a concise, well-formatted digest with sections for:
   - New/updated notes summary
   - Upcoming reminders and overdue items
   - Any patterns or connections you notice

Keep the digest brief and actionable. Use Markdown formatting.
If there is no recent activity, say so briefly.`;
}

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
              await agent.prompt(buildDigestPrompt(config));
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
