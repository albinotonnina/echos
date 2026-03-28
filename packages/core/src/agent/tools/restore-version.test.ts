import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { restoreVersionTool } from './restore-version.js';
import { createSqliteStorage, type SqliteStorage } from '../../storage/sqlite.js';
import { createRevisionStorage, type RevisionStorage } from '../../storage/revisions.js';
import { createMarkdownStorage, type MarkdownStorage } from '../../storage/markdown.js';
import { createLogger } from '@echos/shared';
import type { NoteMetadata } from '@echos/shared';

const logger = createLogger('test', 'silent');

let sqlite: SqliteStorage;
let revisions: RevisionStorage;
let markdown: MarkdownStorage;
let tempDir: string;
let knowledgeDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'echos-restore-test-'));
  sqlite = createSqliteStorage(join(tempDir, 'test.db'), logger);
  revisions = createRevisionStorage(sqlite.db);
  knowledgeDir = join(tempDir, 'knowledge');
  markdown = createMarkdownStorage(knowledgeDir, logger);
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function makeMeta(overrides: Partial<NoteMetadata> = {}): NoteMetadata {
  return {
    id: 'note-1',
    type: 'note',
    title: 'Current Title',
    created: '2024-01-01T00:00:00Z',
    updated: '2024-01-01T00:00:00Z',
    tags: ['current'],
    links: [],
    category: 'general',
    ...overrides,
  };
}

const mockEmbedding = vi.fn(async (_text: string) => [0.1, 0.2, 0.3]);
const mockVectorDb = {
  upsert: vi.fn(),
  search: vi.fn(),
  delete: vi.fn(),
};

function createTool() {
  return restoreVersionTool({
    sqlite,
    revisions,
    markdown,
    vectorDb: mockVectorDb as never,
    generateEmbedding: mockEmbedding,
  });
}

describe('restore_version tool', () => {
  it('throws when note does not exist', async () => {
    const tool = createTool();
    await expect(
      tool.execute('call-id', { noteId: 'nonexistent', revisionId: 'rev-1' }, undefined as never, undefined),
    ).rejects.toThrow('Note not found');
  });

  it('throws when revision does not exist', async () => {
    const meta = makeMeta();
    const filePath = markdown.save(meta, 'content');
    sqlite.upsertNote(meta, 'content', filePath);

    const tool = createTool();
    await expect(
      tool.execute('call-id', { noteId: 'note-1', revisionId: 'nonexistent' }, undefined as never, undefined),
    ).rejects.toThrow('Revision not found');
  });

  it('throws when revision does not belong to the given note', async () => {
    const meta1 = makeMeta({ id: 'note-1' });
    const meta2 = makeMeta({ id: 'note-2', title: 'Other' });
    const fp1 = markdown.save(meta1, 'content 1');
    const fp2 = markdown.save(meta2, 'content 2');
    sqlite.upsertNote(meta1, 'content 1', fp1);
    sqlite.upsertNote(meta2, 'content 2', fp2);

    const revId = revisions.saveRevision('note-2', 'Other', 'old content', '', 'general');

    const tool = createTool();
    await expect(
      tool.execute('call-id', { noteId: 'note-1', revisionId: revId }, undefined as never, undefined),
    ).rejects.toThrow('does not belong to note');
  });

  it('saves current state as a new revision before restoring', async () => {
    const meta = makeMeta();
    const filePath = markdown.save(meta, 'current content');
    sqlite.upsertNote(meta, 'current content', filePath);

    // Create a revision to restore from
    const revId = revisions.saveRevision('note-1', 'Old Title', 'old content', 'old', 'old-cat');

    // Should have 1 revision before restore
    expect(revisions.getRevisions('note-1')).toHaveLength(1);

    const tool = createTool();
    await tool.execute('call-id', { noteId: 'note-1', revisionId: revId }, undefined as never, undefined);

    // Should have 2 revisions: the pre-restore snapshot + the original
    const allRevisions = revisions.getRevisions('note-1');
    expect(allRevisions).toHaveLength(2);

    // Newest revision should be the snapshot of current state
    const snapshot = allRevisions[0]!;
    expect(snapshot.title).toBe('Current Title');
    expect(snapshot.content).toBe('current content');
    expect(snapshot.tags).toBe('current');
  });

  it('restores note content, tags, and category from revision', async () => {
    const meta = makeMeta();
    const filePath = markdown.save(meta, 'current content');
    sqlite.upsertNote(meta, 'current content', filePath);

    const revId = revisions.saveRevision('note-1', 'Old Title', 'old content', 'old-tag', 'old-category');

    const tool = createTool();
    await tool.execute('call-id', { noteId: 'note-1', revisionId: revId }, undefined as never, undefined);

    // Verify SQLite was updated with restored values
    const restored = sqlite.getNote('note-1');
    expect(restored).toBeDefined();
    expect(restored!.title).toBe('Old Title');
    expect(restored!.content).toBe('old content');
    expect(restored!.tags).toBe('old-tag');
    expect(restored!.category).toBe('old-category');
  });

  it('returns confirmation message with revision timestamp', async () => {
    const meta = makeMeta();
    const filePath = markdown.save(meta, 'current content');
    sqlite.upsertNote(meta, 'current content', filePath);

    const revId = revisions.saveRevision('note-1', 'Old Title', 'old content', '', 'general');

    const tool = createTool();
    const result = await tool.execute('call-id', { noteId: 'note-1', revisionId: revId }, undefined as never, undefined);

    const text = result.content.find((c) => c.type === 'text');
    expect(text).toBeDefined();
    expect((text as { text: string }).text).toContain('Restored note');
    expect((text as { text: string }).text).toContain('Previous state saved');
  });
});
