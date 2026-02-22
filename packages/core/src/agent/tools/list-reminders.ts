import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { SqliteStorage } from '../../storage/sqlite.js';

export interface ListRemindersToolDeps {
    sqlite: SqliteStorage;
}

const schema = Type.Object({
    completed: Type.Optional(
        Type.Boolean({
            description:
                'Filter by completion status. true = completed only, false = pending only, omit = all.',
        }),
    ),
});

type Params = Static<typeof schema>;

export function listRemindersTool(deps: ListRemindersToolDeps): AgentTool<typeof schema> {
    return {
        name: 'list_reminders',
        label: 'List Reminders',
        description: 'List reminders, optionally filtered by completion status.',
        parameters: schema,
        execute: async (_toolCallId, params: Params) => {
            const reminders = deps.sqlite.listReminders(params.completed);

            if (reminders.length === 0) {
                const qualifier =
                    params.completed === true
                        ? 'completed '
                        : params.completed === false
                            ? 'pending '
                            : '';
                return {
                    content: [{ type: 'text' as const, text: `No ${qualifier}reminders found.` }],
                    details: {},
                };
            }

            const lines = reminders.map((r) => {
                const status = r.completed ? '✅' : '⬜';
                const due = r.dueDate ? ` | due: ${r.dueDate}` : '';
                return `${status} [${r.id}] ${r.title} (${r.priority}${due})`;
            });

            return {
                content: [{ type: 'text' as const, text: lines.join('\n') }],
                details: { count: reminders.length },
            };
        },
    };
}
