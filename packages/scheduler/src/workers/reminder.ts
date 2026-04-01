import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import type { NotificationService, ReminderEntry, RecurrencePattern } from '@echos/shared';
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
  const recur = r.recurrence ? ` [${r.recurrence}]` : '';
  const desc = r.description ? `\n  ${r.description}` : '';
  return `[${priorityIcon}] **${r.title}**${due}${recur}${desc}`;
}

/**
 * Compute the next occurrence for a recurring reminder based on its current due date.
 * Advances by the recurrence interval from the original due date, skipping past `now`
 * so that missed occurrences don't pile up.
 */
function advanceByMonth(date: Date): void {
  const targetMonth = date.getUTCMonth() + 1;
  const dayOfMonth = date.getUTCDate();
  // Move to day 1 of the target month to avoid overflow, then clamp
  date.setUTCDate(1);
  date.setUTCMonth(targetMonth);
  // Clamp to last day of the target month if original day exceeds it
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(dayOfMonth, lastDay));
}

function computeNextDueDate(currentDue: string, pattern: RecurrencePattern, now: number): string {
  const next = new Date(currentDue);

  // Advance at least once, then keep advancing until we're in the future
  do {
    switch (pattern) {
      case 'daily':
        next.setUTCDate(next.getUTCDate() + 1);
        break;
      case 'weekly':
        next.setUTCDate(next.getUTCDate() + 7);
        break;
      case 'monthly':
        advanceByMonth(next);
        break;
      default:
        throw new Error(`Unsupported recurrence pattern: ${String(pattern)}`);
    }
  } while (next.getTime() <= now);

  return next.toISOString();
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
    const message = `**Reminder Check**\n\nYou have ${due.length} due reminder${due.length > 1 ? 's' : ''}:\n\n${lines.join('\n\n')}`;

    await notificationService.broadcast(message);

    const nowIso = new Date(now).toISOString();
    for (const r of due) {
      if (r.recurrence && r.dueDate) {
        // Recurring reminder: advance to the next occurrence instead of completing
        const nextDue = computeNextDueDate(r.dueDate, r.recurrence, now);
        sqlite.upsertReminder({ ...r, dueDate: nextDue, updated: nowIso });
        logger.info({ reminderId: r.id, nextDue, recurrence: r.recurrence }, 'Recurring reminder rescheduled');
      } else {
        // One-time reminder: mark as completed
        sqlite.upsertReminder({ ...r, completed: true, updated: nowIso });
      }
    }

    logger.info({ count: due.length }, 'Due reminder notifications processed');
  };
}
