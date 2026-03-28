import { describe, it, expect, vi } from 'vitest';
import { restoreNoteTool } from './restore-note.js';
import type { SqliteStorage, NoteRow } from '../../storage/sqlite.js';
import type { MarkdownStorage } from '../../storage/markdown.js';

function makeRow(overrides: Partial<NoteRow> = {}): NoteRow {
  return {
    id: 'note-1',
    type: 'note',
    title: 'Test Note',
    content: 'Test content',
    filePath: '/data/knowledge/.trash/note/uncategorized/2025-01-01-test-note.md',
    tags: 'test',
    links: '',
    category: 'uncategorized',
    sourceUrl: null,
    author: null,
    gist: null,
    created: '2025-01-01T00:00:00.000Z',
    updated: '2025-01-01T00:00:00.000Z',
    contentHash: null,
    status: 'deleted',
    inputSource: null,
    imagePath: null,
    imageUrl: null,
    imageMetadata: null,
    ocrText: null,
    deletedAt: '2025-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('restoreNoteTool', () => {
  it('restores a soft-deleted note from trash', async () => {
    const row = makeRow();
    const restoreFromTrash = vi.fn();
    const restoreNote = vi.fn();

    const sqlite = {
      getNote: vi.fn(() => row),
      restoreNote,
    } as unknown as SqliteStorage;

    const markdown = {
      restoreFromTrash,
    } as unknown as MarkdownStorage;

    const tool = restoreNoteTool({ sqlite, markdown });
    const result = await tool.execute('call-1', { noteId: 'note-1' });

    expect(restoreFromTrash).toHaveBeenCalledWith(
      '/data/knowledge/.trash/note/uncategorized/2025-01-01-test-note.md',
      '/data/knowledge/note/uncategorized/2025-01-01-test-note.md',
    );
    expect(restoreNote).toHaveBeenCalledWith(
      'note-1',
      '/data/knowledge/note/uncategorized/2025-01-01-test-note.md',
    );

    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain('Restored');
    expect(text).toContain('Test Note');
  });

  it('throws if note is not found', async () => {
    const sqlite = {
      getNote: vi.fn(() => undefined),
    } as unknown as SqliteStorage;

    const markdown = {} as unknown as MarkdownStorage;

    const tool = restoreNoteTool({ sqlite, markdown });
    await expect(tool.execute('call-2', { noteId: 'missing' })).rejects.toThrow('Note not found');
  });

  it('throws if note is not in trash', async () => {
    const row = makeRow({
      status: 'saved',
      filePath: '/data/knowledge/note/uncategorized/2025-01-01-test-note.md',
      deletedAt: null,
    });

    const sqlite = {
      getNote: vi.fn(() => row),
    } as unknown as SqliteStorage;

    const markdown = {} as unknown as MarkdownStorage;

    const tool = restoreNoteTool({ sqlite, markdown });
    await expect(tool.execute('call-3', { noteId: 'note-1' })).rejects.toThrow('not in the trash');
  });

  it('throws if file_path does not contain .trash/', async () => {
    const row = makeRow({
      filePath: '/data/knowledge/note/uncategorized/2025-01-01-test-note.md',
    });

    const sqlite = {
      getNote: vi.fn(() => row),
    } as unknown as SqliteStorage;

    const markdown = {} as unknown as MarkdownStorage;

    const tool = restoreNoteTool({ sqlite, markdown });
    await expect(tool.execute('call-4', { noteId: 'note-1' })).rejects.toThrow(
      'does not contain /.trash/',
    );
  });
});
