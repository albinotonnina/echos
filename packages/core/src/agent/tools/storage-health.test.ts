import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createStorageHealthTool } from './storage-health.js';
import { createSqliteStorage, type SqliteStorage } from '../../storage/sqlite.js';
import { createLogger } from '@echos/shared';
import type { NoteMetadata } from '@echos/shared';
import type { MarkdownStorage } from '../../storage/markdown.js';
import type { VectorStorage } from '../../storage/vectordb.js';

const logger = createLogger('test', 'silent');

let sqlite: SqliteStorage;
let tempDir: string;

function makeMeta(overrides: Partial<NoteMetadata> = {}): NoteMetadata {
  return {
    id: 'test-1',
    type: 'note',
    title: 'Test Note',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    tags: [],
    links: [],
    category: 'general',
    ...overrides,
  };
}

function makeMarkdownMock(notes: { id: string }[] = []): MarkdownStorage {
  return {
    list: () =>
      notes.map((n) => ({
        metadata: makeMeta({ id: n.id }),
        content: '',
        filePath: `/fake/path/${n.id}.md`,
      })),
    save: () => '',
    read: () => undefined,
    readById: () => undefined,
    update: () => ({ metadata: makeMeta(), content: '', filePath: '' }),
    remove: () => undefined,
    registerFile: () => undefined,
    unregisterFile: () => undefined,
  };
}

function makeVectorMock(
  embeddings: { id: string; isBroken: boolean }[] = [],
): VectorStorage {
  return {
    upsert: async () => undefined,
    search: async () => [],
    remove: async () => undefined,
    close: () => undefined,
    listAllIds: async () => embeddings.map((e) => e.id),
    getEmbeddingHealth: async () => embeddings,
  };
}

function callTool(
  markdownMock: MarkdownStorage,
  vectorMock: VectorStorage,
) {
  const tool = createStorageHealthTool({
    sqlite,
    markdown: markdownMock,
    vectorDb: vectorMock,
  });
  return tool.execute('call-id', {}, undefined as never, undefined);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'echos-storage-health-test-'));
  sqlite = createSqliteStorage(join(tempDir, 'test.db'), logger);
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('storage_health — empty database', () => {
  it('returns healthy status with zero counts', async () => {
    const result = await callTool(makeMarkdownMock(), makeVectorMock());
    expect(result.details).toMatchObject({
      totalNotes: 0,
      orphanedMarkdownFiles: { count: 0 },
      orphanedSqliteRows: { count: 0 },
      brokenEmbeddings: { count: 0 },
      missingEmbeddings: { count: 0 },
    });
    const text = result.content.find((c) => c.type === 'text');
    expect(text && 'text' in text ? text.text : '').toContain('✅ Healthy');
  });
});

describe('storage_health — orphaned markdown files', () => {
  it('detects markdown files not in SQLite', async () => {
    // markdown has an ID that sqlite does not know about
    const result = await callTool(
      makeMarkdownMock([{ id: 'orphan-md-1' }]),
      makeVectorMock(),
    );
    expect(result.details.orphanedMarkdownFiles.count).toBe(1);
    expect(result.details.orphanedMarkdownFiles.ids).toContain('orphan-md-1');
  });

  it('does not flag markdown files that are also in SQLite', async () => {
    const noteDir = join(tempDir, 'notes');
    mkdirSync(noteDir, { recursive: true });
    const filePath = join(noteDir, 'test.md');
    writeFileSync(filePath, '# test');
    sqlite.upsertNote(makeMeta({ id: 'note-1' }), '', filePath);

    const result = await callTool(
      makeMarkdownMock([{ id: 'note-1' }]),
      makeVectorMock([{ id: 'note-1', isBroken: false }]),
    );
    expect(result.details.orphanedMarkdownFiles.count).toBe(0);
  });
});

describe('storage_health — orphaned SQLite rows', () => {
  it('detects SQLite rows whose file path does not exist on disk', async () => {
    sqlite.upsertNote(makeMeta({ id: 'note-gone' }), '', '/nonexistent/path/note.md');

    const result = await callTool(makeMarkdownMock(), makeVectorMock());
    expect(result.details.orphanedSqliteRows.count).toBe(1);
    expect(result.details.orphanedSqliteRows.items[0]).toMatchObject({
      id: 'note-gone',
      filePath: '/nonexistent/path/note.md',
    });
  });

  it('does not flag rows whose file exists on disk', async () => {
    const noteDir = join(tempDir, 'notes');
    mkdirSync(noteDir, { recursive: true });
    const filePath = join(noteDir, 'real.md');
    writeFileSync(filePath, '# real');
    sqlite.upsertNote(makeMeta({ id: 'note-real' }), '', filePath);

    const result = await callTool(
      makeMarkdownMock([{ id: 'note-real' }]),
      makeVectorMock([{ id: 'note-real', isBroken: false }]),
    );
    expect(result.details.orphanedSqliteRows.count).toBe(0);
  });
});

describe('storage_health — broken and missing embeddings', () => {
  it('detects broken (zero-vector) embeddings', async () => {
    const noteDir = join(tempDir, 'notes');
    mkdirSync(noteDir, { recursive: true });
    const filePath = join(noteDir, 'broken.md');
    writeFileSync(filePath, '# broken');
    sqlite.upsertNote(makeMeta({ id: 'note-broken' }), '', filePath);

    const result = await callTool(
      makeMarkdownMock([{ id: 'note-broken' }]),
      makeVectorMock([{ id: 'note-broken', isBroken: true }]),
    );
    expect(result.details.brokenEmbeddings.count).toBe(1);
    expect(result.details.brokenEmbeddings.ids).toContain('note-broken');
  });

  it('detects notes in SQLite with no embedding in LanceDB', async () => {
    const noteDir = join(tempDir, 'notes');
    mkdirSync(noteDir, { recursive: true });
    const filePath = join(noteDir, 'noembedding.md');
    writeFileSync(filePath, '# no embedding');
    sqlite.upsertNote(makeMeta({ id: 'note-no-embed' }), '', filePath);

    // vector mock has no entry for this id
    const result = await callTool(
      makeMarkdownMock([{ id: 'note-no-embed' }]),
      makeVectorMock([]),
    );
    expect(result.details.missingEmbeddings.count).toBe(1);
    expect(result.details.missingEmbeddings.ids).toContain('note-no-embed');
  });
});

describe('storage_health — output format', () => {
  it('includes status line in text output', async () => {
    const result = await callTool(makeMarkdownMock(), makeVectorMock());
    const text = result.content.find((c) => c.type === 'text');
    const textStr = text && 'text' in text ? text.text : '';
    expect(textStr).toContain('Storage Health Report');
    expect(textStr).toContain('Total notes');
  });

  it('reports issues found when problems exist', async () => {
    sqlite.upsertNote(makeMeta({ id: 'gone' }), '', '/does/not/exist.md');
    const result = await callTool(makeMarkdownMock(), makeVectorMock());
    const text = result.content.find((c) => c.type === 'text');
    const textStr = text && 'text' in text ? text.text : '';
    expect(textStr).toContain('⚠️ Issues found');
  });
});
