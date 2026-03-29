import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { linkNotesTool } from './link-notes.js';
import { createSqliteStorage, type SqliteStorage } from '../../storage/sqlite.js';
import { createMarkdownStorage, type MarkdownStorage } from '../../storage/markdown.js';
import { createLogger, NotFoundError } from '@echos/shared';
import type { NoteMetadata } from '@echos/shared';

const logger = createLogger('test', 'silent');

let sqlite: SqliteStorage;
let markdown: MarkdownStorage;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'echos-link-notes-test-'));
  sqlite = createSqliteStorage(join(tempDir, 'test.db'), logger);
  markdown = createMarkdownStorage(join(tempDir, 'knowledge'), logger);
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function makeMeta(overrides: Partial<NoteMetadata> = {}): NoteMetadata {
  return {
    id: 'note-a',
    type: 'note',
    title: 'Note A',
    created: '2024-01-01T00:00:00Z',
    updated: '2024-01-01T00:00:00Z',
    tags: [],
    links: [],
    category: 'general',
    ...overrides,
  };
}

function callTool(params: { source_id: string; target_id: string }) {
  const tool = linkNotesTool({ sqlite, markdown });
  return tool.execute('call-id', params, undefined as never, undefined);
}

function createNote(meta: NoteMetadata, content = 'body'): string {
  const filePath = markdown.save(meta, content);
  sqlite.upsertNote(meta, content, filePath);
  return filePath;
}

describe('link_notes — successful linking', () => {
  it('creates a bidirectional link and returns success text', async () => {
    const metaA = makeMeta({ id: 'note-a', title: 'Note A' });
    const metaB = makeMeta({ id: 'note-b', title: 'Note B' });
    createNote(metaA);
    createNote(metaB);

    const result = await callTool({ source_id: 'note-a', target_id: 'note-b' });

    const text = result.content.find((c) => c.type === 'text');
    expect(text).toBeDefined();
    if (text && 'text' in text) {
      expect(text.text).toBe('Linked "Note A" ↔ "Note B"');
    }
    expect(result.details).toMatchObject({ sourceId: 'note-a', targetId: 'note-b' });
  });

  it('persists link in SQLite for both notes', async () => {
    const metaA = makeMeta({ id: 'note-a', title: 'Note A' });
    const metaB = makeMeta({ id: 'note-b', title: 'Note B' });
    createNote(metaA);
    createNote(metaB);

    await callTool({ source_id: 'note-a', target_id: 'note-b' });

    const rowA = sqlite.getNote('note-a');
    const rowB = sqlite.getNote('note-b');
    expect(rowA?.links).toContain('note-b');
    expect(rowB?.links).toContain('note-a');
  });

  it('persists link in markdown frontmatter for both notes', async () => {
    const metaA = makeMeta({ id: 'note-a', title: 'Note A' });
    const metaB = makeMeta({ id: 'note-b', title: 'Note B' });
    const pathA = createNote(metaA);
    const pathB = createNote(metaB);

    await callTool({ source_id: 'note-a', target_id: 'note-b' });

    expect(markdown.read(pathA)?.metadata.links).toContain('note-b');
    expect(markdown.read(pathB)?.metadata.links).toContain('note-a');
  });

  it('is idempotent — calling twice does not duplicate links', async () => {
    const metaA = makeMeta({ id: 'note-a', title: 'Note A' });
    const metaB = makeMeta({ id: 'note-b', title: 'Note B' });
    createNote(metaA);
    createNote(metaB);

    await callTool({ source_id: 'note-a', target_id: 'note-b' });
    await callTool({ source_id: 'note-a', target_id: 'note-b' });

    const rowA = sqlite.getNote('note-a');
    const linksA = rowA?.links.split(',').filter(Boolean) ?? [];
    expect(linksA.filter((l) => l === 'note-b')).toHaveLength(1);
  });
});

describe('link_notes — missing note in SQLite', () => {
  it('throws NotFoundError when source note does not exist in SQLite', async () => {
    const metaB = makeMeta({ id: 'note-b', title: 'Note B' });
    createNote(metaB);

    await expect(callTool({ source_id: 'nonexistent', target_id: 'note-b' })).rejects.toThrow(
      NotFoundError,
    );
  });

  it('throws NotFoundError when target note does not exist in SQLite', async () => {
    const metaA = makeMeta({ id: 'note-a', title: 'Note A' });
    createNote(metaA);

    await expect(callTool({ source_id: 'note-a', target_id: 'nonexistent' })).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('link_notes — missing markdown file', () => {
  it('throws NotFoundError when source markdown file is missing', async () => {
    const metaA = makeMeta({ id: 'note-a', title: 'Note A' });
    const metaB = makeMeta({ id: 'note-b', title: 'Note B' });
    const pathA = createNote(metaA);
    createNote(metaB);

    unlinkSync(pathA); // remove the file but keep the SQLite row

    await expect(callTool({ source_id: 'note-a', target_id: 'note-b' })).rejects.toThrow(
      NotFoundError,
    );
  });

  it('throws NotFoundError when target markdown file is missing', async () => {
    const metaA = makeMeta({ id: 'note-a', title: 'Note A' });
    const metaB = makeMeta({ id: 'note-b', title: 'Note B' });
    createNote(metaA);
    const pathB = createNote(metaB);

    unlinkSync(pathB); // remove the file but keep the SQLite row

    await expect(callTool({ source_id: 'note-a', target_id: 'note-b' })).rejects.toThrow(
      NotFoundError,
    );
  });

  it('does not partially update source when target markdown file is missing', async () => {
    const metaA = makeMeta({ id: 'note-a', title: 'Note A' });
    const metaB = makeMeta({ id: 'note-b', title: 'Note B' });
    const pathA = createNote(metaA);
    const pathB = createNote(metaB);

    unlinkSync(pathB);

    await expect(callTool({ source_id: 'note-a', target_id: 'note-b' })).rejects.toThrow();

    // Source should remain unchanged — no partial one-way link
    const rowA = sqlite.getNote('note-a');
    const linksA = rowA?.links.split(',').filter(Boolean) ?? [];
    expect(linksA).not.toContain('note-b');

    const noteA = markdown.read(pathA);
    expect(noteA?.metadata.links).not.toContain('note-b');
  });

  it('error message does not expose full filesystem path', async () => {
    const metaA = makeMeta({ id: 'note-a', title: 'Note A' });
    const metaB = makeMeta({ id: 'note-b', title: 'Note B' });
    const pathA = createNote(metaA);
    createNote(metaB);

    unlinkSync(pathA);

    let thrownError: unknown;
    try {
      await callTool({ source_id: 'note-a', target_id: 'note-b' });
    } catch (e) {
      thrownError = e;
    }

    expect(thrownError).toBeInstanceOf(NotFoundError);
    const errorMessage = (thrownError as Error).message;
    // Must not contain the absolute temp directory path
    expect(errorMessage).not.toContain(tempDir);
  });
});
