import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createSqliteStorage, type SqliteStorage } from './sqlite.js';
import { createLogger, ValidationError } from '@echos/shared';
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

  it('should soft-delete a note (move to trash)', () => {
    storage.upsertNote(makeMeta(), 'content', '/test.md');
    storage.deleteNote('test-1');
    // Soft-deleted: still retrievable but marked as deleted
    const row = storage.getNote('test-1');
    expect(row).toBeDefined();
    expect(row!.status).toBe('deleted');
    expect(row!.deletedAt).toBeTruthy();
    // Excluded from default listNotes
    expect(storage.listNotes()).toHaveLength(0);
    // Visible via listDeletedNotes
    expect(storage.listDeletedNotes()).toHaveLength(1);
  });

  it('should purge a note permanently', () => {
    storage.upsertNote(makeMeta(), 'content', '/test.md');
    storage.deleteNote('test-1');
    storage.purgeNote('test-1');
    expect(storage.getNote('test-1')).toBeUndefined();
  });

  it('should restore a soft-deleted note', () => {
    storage.upsertNote(makeMeta(), 'content', '/test.md');
    storage.deleteNote('test-1');
    storage.restoreNote('test-1');
    const row = storage.getNote('test-1');
    expect(row).toBeDefined();
    expect(row!.status).toBe('saved');
    expect(row!.deletedAt).toBeNull();
    // Visible in default listNotes again
    expect(storage.listNotes()).toHaveLength(1);
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
      kind: 'reminder',
      created: '2024-01-01T00:00:00Z',
      updated: '2024-01-01T00:00:00Z',
    };
    storage.upsertReminder(reminder);

    const result = storage.getReminder('r1');
    expect(result).toBeDefined();
    expect(result!.title).toBe('Buy groceries');
    expect(result!.completed).toBe(false);
    expect(result!.kind).toBe('reminder');
  });

  it('should list incomplete reminders', () => {
    storage.upsertReminder({
      id: 'r1',
      title: 'A',
      priority: 'low',
      completed: false,
      kind: 'reminder',
      created: '2024-01-01T00:00:00Z',
      updated: '2024-01-01T00:00:00Z',
    });
    storage.upsertReminder({
      id: 'r2',
      title: 'B',
      priority: 'high',
      completed: true,
      kind: 'reminder',
      created: '2024-01-01T00:00:00Z',
      updated: '2024-01-01T00:00:00Z',
    });

    const incomplete = storage.listReminders(false);
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0]!.id).toBe('r1');
  });

  it('listReminders excludes todos', () => {
    storage.upsertReminder({
      id: 'r1',
      title: 'Reminder item',
      priority: 'medium',
      completed: false,
      kind: 'reminder',
      created: '2024-01-01T00:00:00Z',
      updated: '2024-01-01T00:00:00Z',
    });
    storage.upsertReminder({
      id: 't1',
      title: 'Todo item',
      priority: 'medium',
      completed: false,
      kind: 'todo',
      created: '2024-01-01T00:00:00Z',
      updated: '2024-01-01T00:00:00Z',
    });

    const reminders = storage.listReminders();
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.id).toBe('r1');
  });

  it('listTodos returns only todos', () => {
    storage.upsertReminder({
      id: 'r1',
      title: 'Reminder item',
      priority: 'medium',
      completed: false,
      kind: 'reminder',
      created: '2024-01-01T00:00:00Z',
      updated: '2024-01-01T00:00:00Z',
    });
    storage.upsertReminder({
      id: 't1',
      title: 'Todo item',
      priority: 'low',
      completed: false,
      kind: 'todo',
      created: '2024-01-01T00:00:00Z',
      updated: '2024-01-01T00:00:00Z',
    });
    storage.upsertReminder({
      id: 't2',
      title: 'Done todo',
      priority: 'high',
      completed: true,
      kind: 'todo',
      created: '2024-01-01T00:00:00Z',
      updated: '2024-01-01T00:00:00Z',
    });

    const all = storage.listTodos();
    expect(all).toHaveLength(2);
    expect(all.every((t) => t.kind === 'todo')).toBe(true);

    const pending = storage.listTodos(false);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe('t1');

    const done = storage.listTodos(true);
    expect(done).toHaveLength(1);
    expect(done[0]!.id).toBe('t2');
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

describe('SQLite Tag Management', () => {
  it('getTopTagsWithCounts returns tags ranked by frequency', () => {
    storage.upsertNote(makeMeta({ id: 'a', tags: ['javascript', 'typescript'] }), '', '/a.md');
    storage.upsertNote(makeMeta({ id: 'b', tags: ['javascript', 'react'] }), '', '/b.md');
    storage.upsertNote(makeMeta({ id: 'c', tags: ['react'] }), '', '/c.md');

    const tags = storage.getTopTagsWithCounts(500);
    expect(tags.find((t) => t.tag === 'javascript')?.count).toBe(2);
    expect(tags.find((t) => t.tag === 'react')?.count).toBe(2);
    expect(tags.find((t) => t.tag === 'typescript')?.count).toBe(1);
    // ranked by count descending
    expect(tags[0]!.count).toBeGreaterThanOrEqual(tags[1]!.count);
  });

  it('getTopTagsWithCounts counts distinct notes, not tag occurrences', () => {
    // A single note with duplicate tags should count as 1, not 2
    storage.upsertNote(makeMeta({ id: 'a', tags: ['js', 'js'] }), '', '/a.md');
    storage.upsertNote(makeMeta({ id: 'b', tags: ['js'] }), '', '/b.md');

    const tags = storage.getTopTagsWithCounts(500);
    // 2 distinct notes have 'js', even though note 'a' has it twice
    expect(tags.find((t) => t.tag === 'js')?.count).toBe(2);
  });

  it('getTopTagsWithCounts limits results in SQL', () => {
    storage.upsertNote(makeMeta({ id: 'a', tags: ['a', 'b', 'c', 'd', 'e'] }), '', '/a.md');

    const top2 = storage.getTopTagsWithCounts(2);
    expect(top2).toHaveLength(2);
  });

  it('renameTag renames a tag across all notes', () => {
    storage.upsertNote(makeMeta({ id: 'a', tags: ['js', 'react'] }), '', '/a.md');
    storage.upsertNote(makeMeta({ id: 'b', tags: ['js'] }), '', '/b.md');
    storage.upsertNote(makeMeta({ id: 'c', tags: ['typescript'] }), '', '/c.md');

    const affected = storage.renameTag('js', 'javascript');
    expect(affected).toBe(2);

    const a = storage.getNote('a');
    expect(a!.tags.split(',').sort()).toEqual(['javascript', 'react'].sort());

    const b = storage.getNote('b');
    expect(b!.tags).toBe('javascript');

    // unaffected note unchanged
    const c = storage.getNote('c');
    expect(c!.tags).toBe('typescript');
  });

  it('renameTag does not match substrings (e.g. "js" does not match "nodejs")', () => {
    storage.upsertNote(makeMeta({ id: 'a', tags: ['nodejs', 'js'] }), '', '/a.md');

    storage.renameTag('js', 'javascript');

    const a = storage.getNote('a');
    const tagList = a!.tags.split(',').sort();
    expect(tagList).toContain('javascript');
    expect(tagList).toContain('nodejs');
    expect(tagList).not.toContain('nodejsavascript');
  });

  it('renameTag deduplicates when target tag already exists on the note', () => {
    storage.upsertNote(makeMeta({ id: 'a', tags: ['js', 'javascript'] }), '', '/a.md');

    storage.renameTag('js', 'javascript');

    const a = storage.getNote('a');
    const tagList = a!.tags.split(',').filter(Boolean);
    // should have exactly one 'javascript', not two
    expect(tagList.filter((t) => t === 'javascript')).toHaveLength(1);
  });

  it('renameTag returns 0 when tag does not exist', () => {
    storage.upsertNote(makeMeta({ id: 'a', tags: ['typescript'] }), '', '/a.md');
    expect(storage.renameTag('nonexistent', 'other')).toBe(0);
  });

  it('mergeTags consolidates multiple source tags into one', () => {
    storage.upsertNote(makeMeta({ id: 'a', tags: ['react'] }), '', '/a.md');
    storage.upsertNote(makeMeta({ id: 'b', tags: ['reactjs'] }), '', '/b.md');
    storage.upsertNote(makeMeta({ id: 'c', tags: ['react-library'] }), '', '/c.md');

    const affected = storage.mergeTags(['react', 'reactjs', 'react-library'], 'react');
    expect(affected).toBe(2); // only b and c needed renaming

    expect(storage.getNote('b')!.tags).toBe('react');
    expect(storage.getNote('c')!.tags).toBe('react');
    expect(storage.getNote('a')!.tags).toBe('react'); // unchanged
  });

  it('mergeTags skips the into tag to avoid self-rename', () => {
    storage.upsertNote(makeMeta({ id: 'a', tags: ['react'] }), '', '/a.md');
    // should not try to rename 'react' to 'react', returning 0 changes for that step
    const affected = storage.mergeTags(['react'], 'react');
    expect(affected).toBe(0);
    expect(storage.getNote('a')!.tags).toBe('react');
  });

  it('renameTag is safe when tag contains SQL wildcard characters (% or _)', () => {
    // A tag containing '%' must not match other tags via LIKE wildcard expansion
    storage.upsertNote(makeMeta({ id: 'a', tags: ['100%'] }), '', '/a.md');
    storage.upsertNote(makeMeta({ id: 'b', tags: ['100x'] }), '', '/b.md');

    // renaming '100%' should only affect note 'a', not 'b'
    const affected = storage.renameTag('100%', 'perfect');
    expect(affected).toBe(1);
    expect(storage.getNote('a')!.tags).toBe('perfect');
    expect(storage.getNote('b')!.tags).toBe('100x');
  });

  it('listNotes tag filter is safe when tag contains SQL wildcard characters', () => {
    storage.upsertNote(makeMeta({ id: 'a', tags: ['100%'] }), '', '/a.md');
    storage.upsertNote(makeMeta({ id: 'b', tags: ['100x'] }), '', '/b.md');

    // filtering by '100%' should return only note 'a', not 'b'
    const results = storage.listNotes({ tags: ['100%'] });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('a');
  });

  it('FTS index stays in sync after renameTag', () => {
    storage.upsertNote(makeMeta({ id: 'a', tags: ['js'] }), 'content', '/a.md');

    storage.renameTag('js', 'javascript');

    // FTS search by new tag should find the note
    const results = storage.searchFts('javascript');
    expect(results.some((r) => r.id === 'a')).toBe(true);
  });

  it('upsertNote rejects tags containing commas', () => {
    expect(() =>
      storage.upsertNote(makeMeta({ id: 'a', tags: ['valid', 'in,valid'] }), 'content', '/a.md'),
    ).toThrow(ValidationError);
  });

  it('upsertNote rejects a tag that is itself only a comma', () => {
    expect(() =>
      storage.upsertNote(makeMeta({ id: 'a', tags: [','] }), 'content', '/a.md'),
    ).toThrow(ValidationError);
  });
});
