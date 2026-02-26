import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createLogger } from '@echos/shared';
import { createSqliteStorage, type SqliteStorage } from '../../storage/sqlite.js';
import { listTodosTool } from './list-todos.js';
import type { ReminderEntry } from '@echos/shared';

const logger = createLogger('test', 'silent');

let tempDir: string;
let sqlite: SqliteStorage;

function makeTodo(overrides: Partial<ReminderEntry> = {}): ReminderEntry {
  return {
    id: 't1',
    title: 'Call John',
    priority: 'medium',
    completed: false,
    kind: 'todo',
    created: '2024-01-01T00:00:00Z',
    updated: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'echos-list-todos-test-'));
  sqlite = createSqliteStorage(join(tempDir, 'test.db'), logger);
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('list_todos tool', () => {
  it('returns empty message when no todos exist', async () => {
    const tool = listTodosTool({ sqlite });
    const result = await tool.execute('tc', {});
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toBe('No todos found.');
  });

  it('returns empty message for pending filter when all are completed', async () => {
    sqlite.upsertReminder(makeTodo({ id: 't1', completed: true }));
    const tool = listTodosTool({ sqlite });
    const result = await tool.execute('tc', { completed: false });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toBe('No pending todos found.');
  });

  it('returns empty message for completed filter when all are pending', async () => {
    sqlite.upsertReminder(makeTodo({ id: 't1', completed: false }));
    const tool = listTodosTool({ sqlite });
    const result = await tool.execute('tc', { completed: true });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toBe('No completed todos found.');
  });

  it('lists all todos with no filter', async () => {
    sqlite.upsertReminder(makeTodo({ id: 't1', title: 'Task A', completed: false }));
    sqlite.upsertReminder(makeTodo({ id: 't2', title: 'Task B', completed: true }));
    const tool = listTodosTool({ sqlite });
    const result = await tool.execute('tc', {});
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Task A');
    expect(text).toContain('Task B');
    expect(text).toContain('⬜');
    expect(text).toContain('✅');
    expect((result.details as { count: number }).count).toBe(2);
  });

  it('filters to pending only when completed=false', async () => {
    sqlite.upsertReminder(makeTodo({ id: 't1', title: 'Pending task', completed: false }));
    sqlite.upsertReminder(makeTodo({ id: 't2', title: 'Done task', completed: true }));
    const tool = listTodosTool({ sqlite });
    const result = await tool.execute('tc', { completed: false });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Pending task');
    expect(text).not.toContain('Done task');
    expect((result.details as { count: number }).count).toBe(1);
  });

  it('filters to completed only when completed=true', async () => {
    sqlite.upsertReminder(makeTodo({ id: 't1', title: 'Pending task', completed: false }));
    sqlite.upsertReminder(makeTodo({ id: 't2', title: 'Done task', completed: true }));
    const tool = listTodosTool({ sqlite });
    const result = await tool.execute('tc', { completed: true });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).not.toContain('Pending task');
    expect(text).toContain('Done task');
    expect((result.details as { count: number }).count).toBe(1);
  });

  it('does NOT return reminders when listing todos', async () => {
    sqlite.upsertReminder(makeTodo({ id: 't1', title: 'My todo', kind: 'todo' }));
    sqlite.upsertReminder(
      makeTodo({ id: 'r1', title: 'My reminder', kind: 'reminder' }),
    );
    const tool = listTodosTool({ sqlite });
    const result = await tool.execute('tc', {});
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('My todo');
    expect(text).not.toContain('My reminder');
    expect((result.details as { count: number }).count).toBe(1);
  });

  it('includes todo id and priority in output', async () => {
    sqlite.upsertReminder(makeTodo({ id: 'my-todo-123', title: 'Fix bug', priority: 'high' }));
    const tool = listTodosTool({ sqlite });
    const result = await tool.execute('tc', {});
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('[my-todo-123]');
    expect(text).toContain('high');
  });
});
