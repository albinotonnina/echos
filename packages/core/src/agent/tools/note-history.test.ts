import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { noteHistoryTool } from './note-history.js';
import { createSqliteStorage, type SqliteStorage } from '../../storage/sqlite.js';
import { createRevisionStorage, type RevisionStorage } from '../../storage/revisions.js';
import { createLogger } from '@echos/shared';
import type { NoteMetadata } from '@echos/shared';

const logger = createLogger('test', 'silent');

let sqlite: SqliteStorage;
let revisions: RevisionStorage;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'echos-note-history-test-'));
  sqlite = createSqliteStorage(join(tempDir, 'test.db'), logger);
  revisions = createRevisionStorage(sqlite.db);
});

afterEach(() => {
  sqlite.close();
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

function firstText(result: { content: { type: string; text?: string }[] }): string {
  const item = result.content.find((c) => c.type === 'text');
  if (!item || !('text' in item)) throw new Error('No text content');
  return item.text as string;
}

describe('note_history tool', () => {
  it('returns empty-history message when no revisions exist', async () => {
    sqlite.upsertNote(makeMeta(), 'content', '/test.md');

    const tool = noteHistoryTool({ sqlite, revisions });
    const result = await tool.execute('call-id', { noteId: 'note-1' }, undefined as never, undefined);

    expect(firstText(result)).toContain('No revision history');
    expect(result.details).toMatchObject({ noteId: 'note-1', count: 0 });
  });

  it('throws when note does not exist', async () => {
    const tool = noteHistoryTool({ sqlite, revisions });

    await expect(
      tool.execute('call-id', { noteId: 'nonexistent' }, undefined as never, undefined),
    ).rejects.toThrow('Note not found');
  });

  it('lists revisions with timestamps and summaries', async () => {
    sqlite.upsertNote(makeMeta(), 'current content', '/test.md');

    revisions.saveRevision('note-1', 'Old Title', 'old content', 'old-tag', 'old-category');
    revisions.saveRevision('note-1', 'Test Note', 'current content', 'test', 'general');

    const tool = noteHistoryTool({ sqlite, revisions });
    const result = await tool.execute('call-id', { noteId: 'note-1' }, undefined as never, undefined);

    const text = firstText(result);
    expect(text).toContain('Revision History');
    expect(text).toContain('Old Title');
    expect(result.details).toMatchObject({ noteId: 'note-1', count: 2 });
  });

  it('respects the limit parameter', async () => {
    sqlite.upsertNote(makeMeta(), 'content', '/test.md');

    for (let i = 0; i < 5; i++) {
      revisions.saveRevision('note-1', `V${i}`, `content ${i}`, '', 'general');
    }

    const tool = noteHistoryTool({ sqlite, revisions });
    const result = await tool.execute('call-id', { noteId: 'note-1', limit: 2 }, undefined as never, undefined);

    expect(result.details).toMatchObject({ count: 2 });
  });

  it('shows diff summary when title changed', async () => {
    sqlite.upsertNote(makeMeta({ title: 'Current Title' }), 'content', '/test.md');

    revisions.saveRevision('note-1', 'Previous Title', 'content', 'test', 'general');

    const tool = noteHistoryTool({ sqlite, revisions });
    const result = await tool.execute('call-id', { noteId: 'note-1' }, undefined as never, undefined);

    expect(firstText(result)).toContain('title was "Previous Title"');
  });
});
