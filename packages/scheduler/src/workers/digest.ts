import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import type { NotificationService } from '@echos/shared';
import type { AgentDeps } from '@echos/core';
import { createEchosAgent } from '@echos/core';
import type { AgentEvent } from '@mariozechner/pi-agent-core';
import type { JobData } from '../queue.js';

export interface DigestWorkerDeps {
  agentDeps: AgentDeps;
  notificationService: NotificationService;
  logger: Logger;
}

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

export function createDigestProcessor(deps: DigestWorkerDeps) {
  return async (_job: Job<JobData>): Promise<void> => {
    const { agentDeps, notificationService, logger } = deps;

    logger.info('Starting digest generation');

    const agent = createEchosAgent(agentDeps);

    let textBuffer = '';
    let toolExecuted = false;

    const unsubscribe = agent.subscribe((event: AgentEvent) => {
      if (event.type === 'message_update' && 'assistantMessageEvent' in event) {
        const ame = event.assistantMessageEvent;
        if (ame.type === 'text_delta') {
          if (toolExecuted && textBuffer.length > 0) {
            textBuffer = textBuffer.trimEnd() + '\n\n';
            toolExecuted = false;
          }
          textBuffer += ame.delta;
        }
      }
      if (event.type === 'tool_execution_start') {
        toolExecuted = true;
      }
    });

    try {
      await agent.prompt(DIGEST_PROMPT);
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
  };
}
