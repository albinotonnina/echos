import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import type { NotificationService, ReminderEntry } from '@echos/shared';
import type { SqliteStorage } from '@echos/core';
import type { JobData } from '../queue.js';

export interface ReminderWorkerDeps {
  sqlite: SqliteStorage;
  notificationService: NotificationService;
  logger: Logger;
}

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function formatReminder(r: ReminderEntry): string {
  const priorityIcon = r.priority === 'high' ? '!' : r.priority === 'medium' ? '-' : '.';
  const due = r.dueDate ? ` (due: ${r.dueDate})` : '';
  const desc = r.description ? `\n  ${r.description}` : '';
  return `[${priorityIcon}] *${r.title}*${due}${desc}`;
}

export function createReminderCheckProcessor(deps: ReminderWorkerDeps) {
  return async (_job: Job<JobData>): Promise<void> => {
    const { sqlite, notificationService, logger } = deps;

    const now = Date.now();

    const pending = sqlite.listReminders(false);

    const due = pending
      .filter((r) => {
        if (!r.dueDate) return false;
        const dueTime = new Date(r.dueDate).getTime();
        if (isNaN(dueTime)) {
          logger.warn({ reminderId: r.id, dueDate: r.dueDate }, 'Reminder has unparseable due date');
          return false;
        }
        if (dueTime > now) return false;
        return true;
      })
      .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2));

    if (due.length === 0) {
      logger.debug('No due reminders found');
      return;
    }

    const lines = due.map(formatReminder);
    const message = `*Reminder Check*\n\nYou have ${due.length} due reminder${due.length > 1 ? 's' : ''}:\n\n${lines.join('\n\n')}`;

    await notificationService.broadcast(message);

    // Mark all notified reminders as completed so they won't appear in future checks
    const nowIso = new Date(now).toISOString();
    for (const r of due) {
      sqlite.upsertReminder({
        ...r,
        completed: true,
        updated: nowIso,
      });
    }

    logger.info({ count: due.length }, 'Due reminder notifications sent and marked as completed');
  };
}
