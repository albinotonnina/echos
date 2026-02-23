import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { createExportNotesTool } from './export-notes.js';
import type { SqliteStorage, NoteRow } from '../../storage/sqlite.js';
import type { MarkdownStorage } from '../../storage/markdown.js';

function firstText(content: Array<{ type: string; text?: string }>): string {
  const item = content.find((c) => c.type === 'text');
  if (!item?.text) throw new Error('No text content in result');
  return item.text;
}

const exportsDir = join(tmpdir(), `echos-tool-export-test-${Date.now()}`);

function makeRow(overrides: Partial<NoteRow> = {}): NoteRow {
  return {
    id: 'note-uuid-001',
    type: 'note',
    title: 'Test Note',
    content: 'Test content',
    filePath: '/data/knowledge/note/uncategorized/2025-01-01-test-note.md',
    tags: 'test,sample',
    links: '',
    category: 'uncategorized',
    sourceUrl: null,
    author: null,
    gist: null,
    created: '2025-01-01T00:00:00.000Z',
    updated: '2025-01-01T00:00:00.000Z',
    contentHash: null,
    status: null,
    inputSource: null,
    imagePath: null,
    imageUrl: null,
    imageMetadata: null,
    ocrText: null,
    ...overrides,
  };
}

function makeDeps(rows: NoteRow[] = [makeRow()]) {
  const sqlite = {
    getNote: vi.fn((id: string) => rows.find((r) => r.id === id) ?? undefined),
    listNotes: vi.fn(() => rows),
  } as unknown as SqliteStorage;

  const markdown = {
    read: vi.fn(() => undefined), // simulate file missing from disk
  } as unknown as MarkdownStorage;

  return { sqlite, markdown, exportsDir };
}

describe('createExportNotesTool', () => {
  beforeEach(() => {
    rmSync(exportsDir, { recursive: true, force: true });
  });

  it('returns inline content for single markdown export', async () => {
    const tool = createExportNotesTool(makeDeps());
    const result = await tool.execute('call-1', { format: 'markdown', id: 'note-uuid-001' });
    const parsed = JSON.parse(firstText(result.content as Array<{ type: string; text?: string }>)) as {
      type: string;
      inline: string;
      format: string;
    };
    expect(parsed.type).toBe('export_file');
    expect(parsed.format).toBe('markdown');
    expect(typeof parsed.inline).toBe('string');
    expect(parsed.inline).toContain('Test content');
  });

  it('returns inline content for single text export', async () => {
    const tool = createExportNotesTool(makeDeps());
    const result = await tool.execute('call-2', { format: 'text', id: 'note-uuid-001' });
    const parsed = JSON.parse(firstText(result.content as Array<{ type: string; text?: string }>)) as {
      inline: string;
      format: string;
    };
    expect(parsed.format).toBe('text');
    expect(parsed.inline).toBe('Test content');
  });

  it('writes a .json file for json format', async () => {
    const tool = createExportNotesTool(makeDeps());
    const result = await tool.execute('call-3', { format: 'json' });
    const parsed = JSON.parse(firstText(result.content as Array<{ type: string; text?: string }>)) as {
      type: string;
      filePath: string;
      format: string;
    };
    expect(parsed.type).toBe('export_file');
    expect(parsed.format).toBe('json');
    expect(existsSync(parsed.filePath)).toBe(true);
  });

  it('writes a .zip file for zip format', async () => {
    const tool = createExportNotesTool(makeDeps());
    const result = await tool.execute('call-4', { format: 'zip' });
    const parsed = JSON.parse(firstText(result.content as Array<{ type: string; text?: string }>)) as {
      type: string;
      filePath: string;
      format: string;
      noteCount: number;
    };
    expect(parsed.format).toBe('zip');
    expect(parsed.noteCount).toBe(1);
    expect(parsed.filePath.endsWith('.zip')).toBe(true);
    expect(existsSync(parsed.filePath)).toBe(true);
  });

  it('auto-switches to zip when multiple notes are exported as markdown', async () => {
    const rows = [makeRow({ id: 'a' }), makeRow({ id: 'b' })];
    const tool = createExportNotesTool(makeDeps(rows));
    const result = await tool.execute('call-5', { format: 'markdown' });
    const parsed = JSON.parse(firstText(result.content as Array<{ type: string; text?: string }>)) as {
      format: string;
    };
    expect(parsed.format).toBe('zip');
  });

  it('returns no-notes message when filter yields nothing', async () => {
    const sqlite = {
      getNote: vi.fn(() => undefined),
      listNotes: vi.fn(() => []),
    } as unknown as SqliteStorage;
    const markdown = { read: vi.fn(() => undefined) } as unknown as MarkdownStorage;
    const tool = createExportNotesTool({ sqlite, markdown, exportsDir });

    const result = await tool.execute('call-6', { format: 'markdown' });
    expect(firstText(result.content as Array<{ type: string; text?: string }>)).toContain('No notes found');
  });

  it('exports arbitrary content directly via content param as text', async () => {
    const tool = createExportNotesTool(makeDeps());
    const result = await tool.execute('call-direct-1', {
      format: 'text',
      content: '**Bold** and *italic* analysis result',
      title: 'Voice Analysis',
    });
    const parsed = JSON.parse(firstText(result.content as Array<{ type: string; text?: string }>)) as {
      type: string;
      format: string;
      inline: string;
    };
    expect(parsed.type).toBe('export_file');
    expect(parsed.format).toBe('text');
    // markdown stripped
    expect(parsed.inline).toContain('Bold');
    expect(parsed.inline).not.toContain('**');
  });

  it('exports arbitrary content directly via content param as markdown', async () => {
    const tool = createExportNotesTool(makeDeps());
    const result = await tool.execute('call-direct-2', {
      format: 'markdown',
      content: '## My analysis\n\nSome text.',
      title: 'Analysis',
    });
    const parsed = JSON.parse(firstText(result.content as Array<{ type: string; text?: string }>)) as {
      inline: string;
      fileName: string;
    };
    // content preserved as-is
    expect(parsed.inline).toBe('## My analysis\n\nSome text.');
    expect(parsed.fileName).toMatch(/analysis.*\.md$/);
  });

  it('does not touch stored notes when content param is provided', async () => {
    const deps = makeDeps();
    const tool = createExportNotesTool(deps);
    await tool.execute('call-direct-3', { format: 'text', content: 'hello' });
    expect((deps.sqlite.getNote as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect((deps.sqlite.listNotes as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('throws when a specific note ID is not found', async () => {
    const deps = makeDeps([]);
    const tool = createExportNotesTool(deps);
    await expect(
      tool.execute('call-7', { format: 'markdown', id: 'non-existent' }),
    ).rejects.toThrow('Note not found');
  });

  it('caps limit at 100', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => makeRow({ id: `id-${i}` }));
    const deps = makeDeps(rows);
    const tool = createExportNotesTool(deps);
    await tool.execute('call-8', { format: 'zip', filter: { limit: 200 } });
    const callArg = (deps.sqlite.listNotes as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      limit: number;
    };
    expect(callArg.limit).toBeLessThanOrEqual(100);
  });
});
