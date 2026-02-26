import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { SqliteStorage } from '../../storage/sqlite.js';

export interface ListTodosToolDeps {
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

export function listTodosTool(deps: ListTodosToolDeps): AgentTool<typeof schema> {
  return {
    name: 'list_todos',
    label: 'List Todos',
    description:
      'List todo items. Returns ONLY todos (kind="todo") — never reminders, notes, or other content. Use list_reminders for time-based reminders.',
    parameters: schema,
    execute: async (_toolCallId, params: Params) => {
      const todos = deps.sqlite.listTodos(params.completed);

      if (todos.length === 0) {
        const qualifier =
          params.completed === true
            ? 'completed '
            : params.completed === false
              ? 'pending '
              : '';
        return {
          content: [{ type: 'text' as const, text: `No ${qualifier}todos found.` }],
          details: {},
        };
      }

      const lines = todos.map((r) => {
        const status = r.completed ? '✅' : '⬜';
        return `${status} [${r.id}] ${r.title} (${r.priority})`;
      });

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        details: { count: todos.length },
      };
    },
  };
}
