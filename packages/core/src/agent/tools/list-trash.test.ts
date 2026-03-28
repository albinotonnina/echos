import { describe, it, expect, vi } from 'vitest';
import { listTrashTool } from './list-trash.js';
import type { SqliteStorage, NoteRow } from '../../storage/sqlite.js';

function makeRow(overrides: Partial<NoteRow> = {}): NoteRow {
  return {
    id: 'note-1',
    type: 'note',
    title: 'Trashed Note',
    content: 'Content',
    filePath: '/data/knowledge/.trash/note/uncategorized/2025-01-01-trashed.md',
    tags: 'test,sample',
    links: '',
    category: 'uncategorized',
    sourceUrl: null,
    author: null,
    gist: null,
    created: '2025-01-01T00:00:00.000Z',
    updated: '2025-06-01T00:00:00.000Z',
    contentHash: null,
    status: 'deleted',
    inputSource: null,
    imagePath: null,
    imageUrl: null,
    imageMetadata: null,
    ocrText: null,
    deletedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
    ...overrides,
  };
}

describe('listTrashTool', () => {
  it('returns empty message when trash is empty', async () => {
    const sqlite = {
      listDeletedNotes: vi.fn(() => []),
    } as unknown as SqliteStorage;

    const tool = listTrashTool({ sqlite });
    const result = await tool.execute('call-1', {});

    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toBe('Trash is empty.');
  });

  it('lists trashed notes with days until purge', async () => {
    const rows = [makeRow()];
    const sqlite = {
      listDeletedNotes: vi.fn(() => rows),
    } as unknown as SqliteStorage;

    const tool = listTrashTool({ sqlite });
    const result = await tool.execute('call-2', {});

    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain('Trash (1 note)');
    expect(text).toContain('Trashed Note');
    expect(text).toContain('[test, sample]');
    expect(text).toContain('days until purge');
  });

  it('shows 0 days until purge for old notes', async () => {
    const rows = [
      makeRow({
        deletedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(), // 35 days ago
      }),
    ];
    const sqlite = {
      listDeletedNotes: vi.fn(() => rows),
    } as unknown as SqliteStorage;

    const tool = listTrashTool({ sqlite });
    const result = await tool.execute('call-3', {});

    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain('0 days until purge');
  });

  it('pluralises correctly for multiple notes', async () => {
    const rows = [makeRow(), makeRow({ id: 'note-2', title: 'Second Note' })];
    const sqlite = {
      listDeletedNotes: vi.fn(() => rows),
    } as unknown as SqliteStorage;

    const tool = listTrashTool({ sqlite });
    const result = await tool.execute('call-4', {});

    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain('Trash (2 notes)');
  });
});
