import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createSqliteStorage, type SqliteStorage } from './sqlite.js';
import { createRevisionStorage, type RevisionStorage } from './revisions.js';
import { createLogger } from '@echos/shared';
import type { NoteMetadata } from '@echos/shared';

const logger = createLogger('test', 'silent');

let storage: SqliteStorage;
let revisions: RevisionStorage;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'echos-revisions-test-'));
  storage = createSqliteStorage(join(tempDir, 'test.db'), logger);
  revisions = createRevisionStorage(storage.db);
});

afterEach(() => {
  storage.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function makeMeta(overrides: Partial<NoteMetadata> = {}): NoteMetadata {
  return {
    id: 'note-1',
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

describe('RevisionStorage', () => {
  it('saves and retrieves a revision', () => {
    storage.upsertNote(makeMeta(), 'content', '/test.md');

    const revId = revisions.saveRevision('note-1', 'Test Note', 'content', 'test', 'general');
    expect(revId).toBeDefined();

    const rev = revisions.getRevision(revId);
    expect(rev).toBeDefined();
    expect(rev!.noteId).toBe('note-1');
    expect(rev!.title).toBe('Test Note');
    expect(rev!.content).toBe('content');
    expect(rev!.tags).toBe('test');
    expect(rev!.category).toBe('general');
  });

  it('lists revisions and returns the correct count', () => {
    storage.upsertNote(makeMeta(), 'content', '/test.md');

    revisions.saveRevision('note-1', 'V1', 'v1 content', '', 'general');
    revisions.saveRevision('note-1', 'V2', 'v2 content', '', 'general');
    revisions.saveRevision('note-1', 'V3', 'v3 content', '', 'general');

    const list = revisions.getRevisions('note-1');
    expect(list).toHaveLength(3);
    const titles = list.map((r) => r.title).sort();
    expect(titles).toEqual(['V1', 'V2', 'V3']);
  });

  it('respects the limit parameter', () => {
    storage.upsertNote(makeMeta(), 'content', '/test.md');

    for (let i = 0; i < 5; i++) {
      revisions.saveRevision('note-1', `V${i}`, `content ${i}`, '', 'general');
    }

    const list = revisions.getRevisions('note-1', 2);
    expect(list).toHaveLength(2);
  });

  it('returns undefined for nonexistent revision', () => {
    expect(revisions.getRevision('nonexistent')).toBeUndefined();
  });

  it('returns empty array for note with no revisions', () => {
    expect(revisions.getRevisions('nonexistent')).toHaveLength(0);
  });

  it('auto-prunes beyond 50 revisions', () => {
    storage.upsertNote(makeMeta(), 'content', '/test.md');

    for (let i = 0; i < 52; i++) {
      revisions.saveRevision('note-1', `V${i}`, `content ${i}`, '', 'general');
    }

    const list = revisions.getRevisions('note-1', 100);
    expect(list).toHaveLength(50);
  });

  it('pruneRevisions removes oldest beyond keepCount', () => {
    storage.upsertNote(makeMeta(), 'content', '/test.md');

    for (let i = 0; i < 10; i++) {
      revisions.saveRevision('note-1', `V${i}`, `content ${i}`, '', 'general');
    }

    const pruned = revisions.pruneRevisions('note-1', 3);
    expect(pruned).toBe(7);

    const remaining = revisions.getRevisions('note-1');
    expect(remaining).toHaveLength(3);
  });

  it('pruneRevisions returns 0 when under keepCount', () => {
    storage.upsertNote(makeMeta(), 'content', '/test.md');

    revisions.saveRevision('note-1', 'V1', 'content', '', 'general');
    const pruned = revisions.pruneRevisions('note-1', 10);
    expect(pruned).toBe(0);
  });

  it('revisions are cascade-deleted when note is deleted', () => {
    storage.upsertNote(makeMeta(), 'content', '/test.md');
    revisions.saveRevision('note-1', 'V1', 'content 1', '', 'general');
    revisions.saveRevision('note-1', 'V2', 'content 2', '', 'general');

    expect(revisions.getRevisions('note-1')).toHaveLength(2);

    storage.deleteNote('note-1');

    expect(revisions.getRevisions('note-1')).toHaveLength(0);
  });

  it('keeps revisions for other notes when one note is deleted', () => {
    storage.upsertNote(makeMeta({ id: 'note-1' }), 'content', '/a.md');
    storage.upsertNote(makeMeta({ id: 'note-2' }), 'content', '/b.md');

    revisions.saveRevision('note-1', 'V1', 'content', '', 'general');
    revisions.saveRevision('note-2', 'V1', 'content', '', 'general');

    storage.deleteNote('note-1');

    expect(revisions.getRevisions('note-1')).toHaveLength(0);
    expect(revisions.getRevisions('note-2')).toHaveLength(1);
  });
});
