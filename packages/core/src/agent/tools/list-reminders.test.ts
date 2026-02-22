import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createLogger } from '@echos/shared';
import { createSqliteStorage, type SqliteStorage } from '../../storage/sqlite.js';
import { listRemindersTool } from './list-reminders.js';
import type { ReminderEntry } from '@echos/shared';

const logger = createLogger('test', 'silent');

let tempDir: string;
let sqlite: SqliteStorage;

function makeReminder(overrides: Partial<ReminderEntry> = {}): ReminderEntry {
    return {
        id: 'r1',
        title: 'Buy groceries',
        priority: 'medium',
        completed: false,
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
        ...overrides,
    };
}

beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'echos-list-reminders-test-'));
    sqlite = createSqliteStorage(join(tempDir, 'test.db'), logger);
});

afterEach(() => {
    sqlite.close();
    rmSync(tempDir, { recursive: true, force: true });
});

describe('list_reminders tool', () => {
    it('returns empty message when no reminders exist', async () => {
        const tool = listRemindersTool({ sqlite });
        const result = await tool.execute('tc', {});
        const text = (result.content[0] as { type: 'text'; text: string }).text;
        expect(text).toBe('No reminders found.');
    });

    it('returns empty message for pending filter when all are completed', async () => {
        sqlite.upsertReminder(makeReminder({ id: 'r1', completed: true }));
        const tool = listRemindersTool({ sqlite });
        const result = await tool.execute('tc', { completed: false });
        const text = (result.content[0] as { type: 'text'; text: string }).text;
        expect(text).toBe('No pending reminders found.');
    });

    it('returns empty message for completed filter when all are pending', async () => {
        sqlite.upsertReminder(makeReminder({ id: 'r1', completed: false }));
        const tool = listRemindersTool({ sqlite });
        const result = await tool.execute('tc', { completed: true });
        const text = (result.content[0] as { type: 'text'; text: string }).text;
        expect(text).toBe('No completed reminders found.');
    });

    it('lists all reminders with no filter', async () => {
        sqlite.upsertReminder(makeReminder({ id: 'r1', title: 'Task A', completed: false }));
        sqlite.upsertReminder(makeReminder({ id: 'r2', title: 'Task B', completed: true }));
        const tool = listRemindersTool({ sqlite });
        const result = await tool.execute('tc', {});
        const text = (result.content[0] as { type: 'text'; text: string }).text;
        expect(text).toContain('Task A');
        expect(text).toContain('Task B');
        expect(text).toContain('⬜');
        expect(text).toContain('✅');
        expect((result.details as { count: number }).count).toBe(2);
    });

    it('filters to pending only when completed=false', async () => {
        sqlite.upsertReminder(makeReminder({ id: 'r1', title: 'Pending', completed: false }));
        sqlite.upsertReminder(makeReminder({ id: 'r2', title: 'Done', completed: true }));
        const tool = listRemindersTool({ sqlite });
        const result = await tool.execute('tc', { completed: false });
        const text = (result.content[0] as { type: 'text'; text: string }).text;
        expect(text).toContain('Pending');
        expect(text).not.toContain('Done');
        expect((result.details as { count: number }).count).toBe(1);
    });

    it('filters to completed only when completed=true', async () => {
        sqlite.upsertReminder(makeReminder({ id: 'r1', title: 'Pending', completed: false }));
        sqlite.upsertReminder(makeReminder({ id: 'r2', title: 'Done', completed: true }));
        const tool = listRemindersTool({ sqlite });
        const result = await tool.execute('tc', { completed: true });
        const text = (result.content[0] as { type: 'text'; text: string }).text;
        expect(text).not.toContain('Pending');
        expect(text).toContain('Done');
        expect((result.details as { count: number }).count).toBe(1);
    });

    it('includes due date in output when set', async () => {
        sqlite.upsertReminder(
            makeReminder({ id: 'r1', title: 'Call dentist', dueDate: '2026-03-01T09:00:00Z' }),
        );
        const tool = listRemindersTool({ sqlite });
        const result = await tool.execute('tc', {});
        const text = (result.content[0] as { type: 'text'; text: string }).text;
        expect(text).toContain('due: 2026-03-01T09:00:00Z');
    });

    it('omits due date when not set', async () => {
        sqlite.upsertReminder(makeReminder({ id: 'r1', title: 'No deadline' }));
        const tool = listRemindersTool({ sqlite });
        const result = await tool.execute('tc', {});
        const text = (result.content[0] as { type: 'text'; text: string }).text;
        expect(text).not.toContain('due:');
    });

    it('includes reminder id and priority in output', async () => {
        sqlite.upsertReminder(makeReminder({ id: 'my-id-123', title: 'Check email', priority: 'high' }));
        const tool = listRemindersTool({ sqlite });
        const result = await tool.execute('tc', {});
        const text = (result.content[0] as { type: 'text'; text: string }).text;
        expect(text).toContain('[my-id-123]');
        expect(text).toContain('high');
    });
});
