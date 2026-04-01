import type { Logger } from 'pino';
import type { ReminderEntry, RecurrencePattern } from '@echos/shared';
import type { PreparedStatements } from './sqlite-schema.js';

export interface ReminderOps {
  upsertReminder(reminder: ReminderEntry): void;
  getReminder(id: string): ReminderEntry | undefined;
  listReminders(completed?: boolean): ReminderEntry[];
  listTodos(completed?: boolean): ReminderEntry[];
}

const VALID_RECURRENCE = new Set<string>(['daily', 'weekly', 'monthly']);

function rowToReminder(row: Record<string, unknown>): ReminderEntry {
  const entry: ReminderEntry = {
    id: row['id'] as string,
    title: row['title'] as string,
    priority: row['priority'] as ReminderEntry['priority'],
    completed: row['completed'] === 1,
    kind: ((row['kind'] as string | null) ?? 'reminder') as ReminderEntry['kind'],
    created: row['created'] as string,
    updated: row['updated'] as string,
  };
  const desc = row['description'] as string | null;
  if (desc) entry.description = desc;
  const due = row['due_date'] as string | null;
  if (due) entry.dueDate = due;
  const recurrence = row['recurrence'] as string | null;
  if (recurrence !== null && VALID_RECURRENCE.has(recurrence)) {
    entry.recurrence = recurrence as RecurrencePattern;
  }
  return entry;
}

export function createReminderOps(
  _db: unknown,
  stmts: PreparedStatements,
  _logger: Logger,
): ReminderOps {
  return {
    upsertReminder(reminder: ReminderEntry): void {
      stmts.upsertReminder.run({
        id: reminder.id,
        title: reminder.title,
        description: reminder.description ?? null,
        dueDate: reminder.dueDate ?? null,
        priority: reminder.priority,
        completed: reminder.completed ? 1 : 0,
        kind: reminder.kind,
        recurrence: reminder.recurrence ?? null,
        created: reminder.created,
        updated: reminder.updated,
      });
    },

    getReminder(id: string): ReminderEntry | undefined {
      const row = stmts.getReminder.get(id) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return rowToReminder(row);
    },

    listReminders(completed?: boolean): ReminderEntry[] {
      const rows =
        completed === undefined
          ? (stmts.listAllReminders.all('reminder') as Record<string, unknown>[])
          : (stmts.listReminders.all('reminder', completed ? 1 : 0) as Record<string, unknown>[]);
      return rows.map(rowToReminder);
    },

    listTodos(completed?: boolean): ReminderEntry[] {
      const rows =
        completed === undefined
          ? (stmts.listAllTodos.all('todo') as Record<string, unknown>[])
          : (stmts.listTodos.all('todo', completed ? 1 : 0) as Record<string, unknown>[]);
      return rows.map(rowToReminder);
    },
  };
}
