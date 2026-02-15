import { Type, StringEnum, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { v4 as uuidv4 } from 'uuid';
import type { ReminderEntry } from '@echos/shared';
import type { SqliteStorage } from '../../storage/sqlite.js';

export interface ReminderToolDeps {
  sqlite: SqliteStorage;
}

const addSchema = Type.Object({
  title: Type.String({ description: 'Reminder title', minLength: 1 }),
  description: Type.Optional(Type.String({ description: 'Additional details' })),
  due_date: Type.Optional(Type.String({ description: 'Due date (ISO 8601 or natural language date)' })),
  priority: Type.Optional(
    StringEnum(['low', 'medium', 'high'], { description: 'Priority level', default: 'medium' }),
  ),
});

type AddParams = Static<typeof addSchema>;

export function addReminderTool(deps: ReminderToolDeps): AgentTool<typeof addSchema> {
  return {
    name: 'add_reminder',
    label: 'Add Reminder',
    description: 'Create a new reminder or todo item with optional due date and priority.',
    parameters: addSchema,
    execute: async (_toolCallId, params: AddParams) => {
      const now = new Date().toISOString();
      const id = uuidv4();

      const entry: ReminderEntry = {
        id,
        title: params.title,
        priority: (params.priority ?? 'medium') as ReminderEntry['priority'],
        completed: false,
        created: now,
        updated: now,
      };
      if (params.description) entry.description = params.description;
      if (params.due_date) entry.dueDate = params.due_date;

      deps.sqlite.upsertReminder(entry);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Added reminder: "${params.title}" (id: ${id}, priority: ${entry.priority}${params.due_date ? `, due: ${params.due_date}` : ''})`,
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
    description: 'Mark a reminder as completed.',
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
            text: `Completed reminder: "${existing.title}" (${params.id})`,
          },
        ],
        details: { id: params.id, title: existing.title },
      };
    },
  };
}
