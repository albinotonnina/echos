import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createLogger } from '@echos/shared';
import { createSqliteStorage, type SqliteStorage } from '../../storage/sqlite.js';
import { createMarkdownStorage, type MarkdownStorage } from '../../storage/markdown.js';
import { createNoteTool } from './create-note.js';

const logger = createLogger('test', 'silent');

let tempDir: string;
let sqlite: SqliteStorage;
let markdown: MarkdownStorage;

// Minimal mock for VectorStorage
const mockVectorDb = {
  upsert: async () => {},
  search: async () => [],
  remove: async () => {},
  close: () => {},
};

const stubEmbedding = async () => new Array(1536).fill(0);

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'echos-tool-test-'));
  sqlite = createSqliteStorage(join(tempDir, 'test.db'), logger);
  markdown = createMarkdownStorage(join(tempDir, 'knowledge'), logger);
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('create_note tool', () => {
  it('should create a note and persist it to all stores', async () => {
    const tool = createNoteTool({
      sqlite,
      markdown,
      vectorDb: mockVectorDb,
      generateEmbedding: stubEmbedding,
    });

    const result = await tool.execute('tc1', {
      title: 'Test Note',
      content: 'This is a test note about TypeScript.',
      tags: ['test', 'typescript'],
      category: 'programming',
    });

    // Tool returns success message
    expect(result.content[0]!.type).toBe('text');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Created note "Test Note"');
    expect(text).toContain('test, typescript');

    // Verify in SQLite
    const id = (result.details as { id: string }).id;
    const row = sqlite.getNote(id);
    expect(row).toBeDefined();
    expect(row!.title).toBe('Test Note');
    expect(row!.type).toBe('note');

    // Verify markdown file
    const note = markdown.readById(id);
    expect(note).toBeDefined();
    expect(note!.content).toBe('This is a test note about TypeScript.');
    expect(note!.metadata.tags).toEqual(['test', 'typescript']);
  });

  it('should default type to "note" and category to "uncategorized"', async () => {
    const tool = createNoteTool({
      sqlite,
      markdown,
      vectorDb: mockVectorDb,
      generateEmbedding: stubEmbedding,
    });

    const result = await tool.execute('tc2', {
      title: 'Minimal Note',
      content: 'Content only.',
    });

    const id = (result.details as { id: string }).id;
    const row = sqlite.getNote(id);
    expect(row!.type).toBe('note');
    expect(row!.category).toBe('uncategorized');
  });

  it('should create a journal entry', async () => {
    const tool = createNoteTool({
      sqlite,
      markdown,
      vectorDb: mockVectorDb,
      generateEmbedding: stubEmbedding,
    });

    const result = await tool.execute('tc3', {
      title: 'Daily Journal',
      content: 'Today was a good day.',
      type: 'journal',
    });

    const id = (result.details as { id: string }).id;
    const row = sqlite.getNote(id);
    expect(row!.type).toBe('journal');
  });
});
