import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createSqliteStorage, type SqliteStorage } from './sqlite.js';
import { createLogger } from '@echos/shared';
import type { NoteMetadata, ReminderEntry, MemoryEntry } from '@echos/shared';

const logger = createLogger('test', 'silent');

let storage: SqliteStorage;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'echos-test-'));
  storage = createSqliteStorage(join(tempDir, 'test.db'), logger);
});

afterEach(() => {
  storage.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function makeMeta(overrides: Partial<NoteMetadata> = {}): NoteMetadata {
  return {
    id: 'test-1',
    type: 'note',
    title: 'Test Note',
    created: '2024-01-01T00:00:00Z',
    updated: '2024-01-01T00:00:00Z',
    tags: ['test'],
    links: [],
    category: 'general',
    ...overrides,
  };
}

describe('SQLite Notes', () => {
  it('should upsert and retrieve a note', () => {
    const meta = makeMeta();
    storage.upsertNote(meta, 'Hello world', '/test/path.md');

    const row = storage.getNote('test-1');
    expect(row).toBeDefined();
    expect(row!.title).toBe('Test Note');
    expect(row!.content).toBe('Hello world');
    expect(row!.type).toBe('note');
  });

  it('should list notes', () => {
    storage.upsertNote(makeMeta({ id: 'a' }), 'A', '/a.md');
    storage.upsertNote(makeMeta({ id: 'b', title: 'B' }), 'B', '/b.md');

    const notes = storage.listNotes();
    expect(notes).toHaveLength(2);
  });

  it('should list notes by type', () => {
    storage.upsertNote(makeMeta({ id: 'a', type: 'note' }), 'A', '/a.md');
    storage.upsertNote(makeMeta({ id: 'b', type: 'journal' }), 'B', '/b.md');

    const notes = storage.listNotes({ type: 'journal' });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.type).toBe('journal');
  });

  it('should delete a note', () => {
    storage.upsertNote(makeMeta(), 'content', '/test.md');
    storage.deleteNote('test-1');
    expect(storage.getNote('test-1')).toBeUndefined();
  });

  it('should update an existing note via upsert', () => {
    const meta = makeMeta();
    storage.upsertNote(meta, 'original', '/test.md');
    storage.upsertNote({ ...meta, title: 'Updated' }, 'updated content', '/test.md');

    const row = storage.getNote('test-1');
    expect(row!.title).toBe('Updated');
    expect(row!.content).toBe('updated content');
  });

  it('should store and retrieve status and inputSource', () => {
    const meta = makeMeta({ status: 'saved', inputSource: 'url' });
    storage.upsertNote(meta, 'content', '/test.md');

    const row = storage.getNote('test-1');
    expect(row!.status).toBe('saved');
    expect(row!.inputSource).toBe('url');
  });

  it('should list notes by status', () => {
    storage.upsertNote(makeMeta({ id: 'a', status: 'saved' }), 'A', '/a.md');
    storage.upsertNote(makeMeta({ id: 'b', status: 'read' }), 'B', '/b.md');
    storage.upsertNote(makeMeta({ id: 'c' }), 'C', '/c.md');

    const saved = storage.listNotes({ status: 'saved' });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.id).toBe('a');

    const read = storage.listNotes({ status: 'read' });
    expect(read).toHaveLength(1);
    expect(read[0]!.id).toBe('b');
  });

  it('should list notes by type and status', () => {
    storage.upsertNote(makeMeta({ id: 'a', type: 'article', status: 'saved' }), 'A', '/a.md');
    storage.upsertNote(makeMeta({ id: 'b', type: 'article', status: 'read' }), 'B', '/b.md');
    storage.upsertNote(makeMeta({ id: 'c', type: 'note', status: 'saved' }), 'C', '/c.md');

    const savedArticles = storage.listNotes({ type: 'article', status: 'saved' });
    expect(savedArticles).toHaveLength(1);
    expect(savedArticles[0]!.id).toBe('a');
  });

  it('should update note status via updateNoteStatus', () => {
    storage.upsertNote(makeMeta({ status: 'saved' }), 'content', '/test.md');
    storage.updateNoteStatus('test-1', 'read');

    const row = storage.getNote('test-1');
    expect(row!.status).toBe('read');
  });

  it('should support conversation content type', () => {
    storage.upsertNote(
      makeMeta({ id: 'conv-1', type: 'conversation', status: 'read' }),
      'Summary...',
      '/conv.md',
    );

    const row = storage.getNote('conv-1');
    expect(row!.type).toBe('conversation');
    expect(row!.status).toBe('read');
  });
});

describe('SQLite FTS5 Search', () => {
  it('should find notes by keyword', () => {
    storage.upsertNote(
      makeMeta({ id: 'a', title: 'TypeScript Guide' }),
      'Learn TypeScript here',
      '/a.md',
    );
    storage.upsertNote(makeMeta({ id: 'b', title: 'Python Guide' }), 'Learn Python here', '/b.md');

    const results = storage.searchFts('TypeScript');
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('a');
  });

  it('should search across title and content', () => {
    storage.upsertNote(
      makeMeta({ id: 'a', title: 'Generic Title' }),
      'Contains the word quantum',
      '/a.md',
    );

    const results = storage.searchFts('quantum');
    expect(results).toHaveLength(1);
  });

  it('should filter by type', () => {
    storage.upsertNote(makeMeta({ id: 'a', type: 'note' }), 'test content', '/a.md');
    storage.upsertNote(makeMeta({ id: 'b', type: 'article' }), 'test content', '/b.md');

    const results = storage.searchFts('test', { type: 'article' });
    expect(results).toHaveLength(1);
    expect(results[0]!.type).toBe('article');
  });

  it('should handle special characters without throwing', () => {
    storage.upsertNote(
      makeMeta({ id: 'a', title: 'Functional Programming' }),
      'Currying and composition',
      '/a.md',
    );

    // FTS5 special characters that would cause MATCH syntax errors if unsanitized
    const specialQueries = [
      'function()',
      '"unbalanced quote',
      'hello*world',
      'test:value',
      'a & b | c',
      '(nested (parens))',
      '<html>',
      '{brackets}',
      '!@#$%^',
      '',
      '   ',
    ];

    for (const query of specialQueries) {
      expect(() => storage.searchFts(query)).not.toThrow();
    }
  });

  it('should return results for sanitized special-character queries', () => {
    storage.upsertNote(makeMeta({ id: 'a', title: 'Hello World' }), 'Programming basics', '/a.md');

    // Query with special chars wrapping a real term - should still find results
    const results = storage.searchFts('(hello)');
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('a');
  });
});

describe('SQLite Reminders', () => {
  it('should upsert and retrieve a reminder', () => {
    const reminder: ReminderEntry = {
      id: 'r1',
      title: 'Buy groceries',
      priority: 'medium',
      completed: false,
      created: '2024-01-01T00:00:00Z',
      updated: '2024-01-01T00:00:00Z',
    };
    storage.upsertReminder(reminder);

    const result = storage.getReminder('r1');
    expect(result).toBeDefined();
    expect(result!.title).toBe('Buy groceries');
    expect(result!.completed).toBe(false);
  });

  it('should list incomplete reminders', () => {
    storage.upsertReminder({
      id: 'r1',
      title: 'A',
      priority: 'low',
      completed: false,
      created: '2024-01-01T00:00:00Z',
      updated: '2024-01-01T00:00:00Z',
    });
    storage.upsertReminder({
      id: 'r2',
      title: 'B',
      priority: 'high',
      completed: true,
      created: '2024-01-01T00:00:00Z',
      updated: '2024-01-01T00:00:00Z',
    });

    const incomplete = storage.listReminders(false);
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0]!.id).toBe('r1');
  });
});

describe('SQLite Memory', () => {
  it('should upsert and retrieve memory entries', () => {
    const entry: MemoryEntry = {
      id: 'm1',
      kind: 'fact',
      subject: 'coffee',
      content: 'User prefers oat milk lattes',
      confidence: 0.9,
      source: 'conversation',
      created: '2024-01-01T00:00:00Z',
      updated: '2024-01-01T00:00:00Z',
    };
    storage.upsertMemory(entry);

    const result = storage.getMemory('m1');
    expect(result).toBeDefined();
    expect(result!.content).toBe('User prefers oat milk lattes');
    expect(result!.confidence).toBe(0.9);
  });

  it('should search memory by subject or content', () => {
    storage.upsertMemory({
      id: 'm1',
      kind: 'fact',
      subject: 'coffee',
      content: 'Likes oat milk',
      confidence: 0.9,
      source: 'chat',
      created: '2024-01-01T00:00:00Z',
      updated: '2024-01-01T00:00:00Z',
    });
    storage.upsertMemory({
      id: 'm2',
      kind: 'person',
      subject: 'Alice',
      content: 'Works at Acme',
      confidence: 0.8,
      source: 'chat',
      created: '2024-01-01T00:00:00Z',
      updated: '2024-01-01T00:00:00Z',
    });

    const results = storage.searchMemory('coffee');
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('m1');
  });
});

describe('SQLite Job Schedules', () => {
  it('should upsert and retrieve a schedule', () => {
    storage.upsertSchedule({
      id: 'digest',
      jobType: 'digest',
      cron: '0 8 * * *',
      enabled: true,
      description: 'Morning digest',
      config: { lookback: 24 },
      created: '2024-01-01T00:00:00Z',
      updated: '2024-01-01T00:00:00Z',
    });

    const result = storage.getSchedule('digest');
    expect(result).toBeDefined();
    expect(result!.jobType).toBe('digest');
    expect(result!.cron).toBe('0 8 * * *');
    expect(result!.enabled).toBe(true);
    expect(result!.config).toEqual({ lookback: 24 });
  });

  it('should list schedules and filter by enabled', () => {
    storage.upsertSchedule({
      id: 's1',
      jobType: 'type1',
      cron: '* * * * *',
      enabled: true,
      description: '',
      config: {},
      created: '2024-01-01',
      updated: '2024-01-01',
    });
    storage.upsertSchedule({
      id: 's2',
      jobType: 'type2',
      cron: '* * * * *',
      enabled: false,
      description: '',
      config: {},
      created: '2024-01-01',
      updated: '2024-01-01',
    });

    const all = storage.listSchedules();
    expect(all).toHaveLength(2);

    const enabledOnly = storage.listSchedules(true);
    expect(enabledOnly).toHaveLength(1);
    expect(enabledOnly[0]!.id).toBe('s1');

    const disabledOnly = storage.listSchedules(false);
    expect(disabledOnly).toHaveLength(1);
    expect(disabledOnly[0]!.id).toBe('s2');
  });

  it('should delete a schedule', () => {
    storage.upsertSchedule({
      id: 's1',
      jobType: 'type1',
      cron: '* * * * *',
      enabled: true,
      description: '',
      config: {},
      created: '2024-01-01',
      updated: '2024-01-01',
    });

    expect(storage.getSchedule('s1')).toBeDefined();
    const deleted = storage.deleteSchedule('s1');
    expect(deleted).toBe(true);
    expect(storage.getSchedule('s1')).toBeUndefined();

    // Deleting non-existent schedule returns false
    expect(storage.deleteSchedule('missing')).toBe(false);
  });
});
