import { Type, StringEnum, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { v4 as uuidv4 } from 'uuid';
import type { ReminderEntry } from '@echos/shared';
import type { SqliteStorage } from '../../storage/sqlite.js';

export interface ReminderToolDeps {
  sqlite: SqliteStorage;
}

const addSchema = Type.Object({
  title: Type.String({ description: 'Reminder title' }),
  description: Type.Optional(Type.String({ description: 'Additional details' })),
  due_date: Type.Optional(Type.String({ description: 'Due date in ISO 8601 format' })),
  priority: Type.Optional(
    StringEnum(['low', 'medium', 'high'], { description: 'Priority level', default: 'medium' }),
  ),
  kind: Type.Optional(
    StringEnum(['reminder', 'todo'], {
      description: '"todo" for action items, "reminder" for time-based. Default: "reminder"',
    }),
  ),
  recurrence: Type.Optional(
    StringEnum(['daily', 'weekly', 'monthly'], {
      description: 'Recurrence pattern (only if explicitly requested)',
    }),
  ),
});

type AddParams = Static<typeof addSchema>;

export function addReminderTool(deps: ReminderToolDeps): AgentTool<typeof addSchema> {
  return {
    name: 'add_reminder',
    label: 'Add Reminder',
    description:
      'Create a reminder or todo. Use kind="todo" for action items (no due date required). Use kind="reminder" for time-based reminders with a due date.',
    parameters: addSchema,
    execute: async (_toolCallId, params: AddParams) => {
      const now = new Date().toISOString();
      const id = uuidv4();

      const kind = (params.kind ?? 'reminder') as ReminderEntry['kind'];
      const entry: ReminderEntry = {
        id,
        title: params.title,
        priority: (params.priority ?? 'medium') as ReminderEntry['priority'],
        completed: false,
        kind,
        created: now,
        updated: now,
      };
      if (params.description) entry.description = params.description;
      if (params.due_date) {
        const parsed = new Date(params.due_date);
        if (isNaN(parsed.getTime())) {
          throw new Error(`Invalid due date: "${params.due_date}". Provide an ISO 8601 date (e.g. "2026-02-16T19:49:00Z").`);
        }
        entry.dueDate = parsed.toISOString();
      }
      if (params.recurrence !== undefined) {
        if (kind !== 'reminder') {
          throw new Error('Recurrence can only be set on reminders (kind="reminder"), not todos.');
        }
        if (!params.due_date) {
          throw new Error('Recurrence requires a due_date. Provide a due date for the first occurrence.');
        }
        entry.recurrence = params.recurrence as NonNullable<ReminderEntry['recurrence']>;
      }

      deps.sqlite.upsertReminder(entry);

      const recurrenceLabel = params.recurrence ? `, repeats: ${params.recurrence}` : '';
      return {
        content: [
          {
            type: 'text' as const,
            text: `Added ${kind}: "${params.title}" (id: ${id}, priority: ${entry.priority}${params.due_date ? `, due: ${params.due_date}` : ''}${recurrenceLabel})`,
          },
        ],
        details: { id },
      };
    },
  };
}

const completeSchema = Type.Object({
  id: Type.String({ description: 'Reminder ID to mark as completed' }),
});

type CompleteParams = Static<typeof completeSchema>;

export function completeReminderTool(deps: ReminderToolDeps): AgentTool<typeof completeSchema> {
  return {
    name: 'complete_reminder',
    label: 'Complete Reminder',
    description: 'Mark any reminder or todo as done by its id. Works for both kind="todo" and kind="reminder".',
    parameters: completeSchema,
    execute: async (_toolCallId, params: CompleteParams) => {
      const existing = deps.sqlite.getReminder(params.id);
      if (!existing) {
        throw new Error(`Reminder not found: ${params.id}`);
      }

      deps.sqlite.upsertReminder({
        ...existing,
        completed: true,
        updated: new Date().toISOString(),
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Completed ${existing.kind}: "${existing.title}" (${params.id})`,
          },
        ],
        details: { id: params.id, title: existing.title },
      };
    },
  };
}
