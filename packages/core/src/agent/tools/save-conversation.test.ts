import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createLogger } from '@echos/shared';
import { createSqliteStorage, type SqliteStorage } from '../../storage/sqlite.js';
import { createMarkdownStorage, type MarkdownStorage } from '../../storage/markdown.js';
import { saveConversationTool } from './save-conversation.js';

const logger = createLogger('test', 'silent');

let tempDir: string;
let sqlite: SqliteStorage;
let markdown: MarkdownStorage;

const mockVectorDb = {
  upsert: async () => {},
  search: async () => [],
  remove: async () => {},
  close: () => {},
};

const stubEmbedding = async () => new Array(1536).fill(0);

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'echos-save-convo-test-'));
  sqlite = createSqliteStorage(join(tempDir, 'test.db'), logger);
  markdown = createMarkdownStorage(join(tempDir, 'knowledge'), logger);
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('save_conversation tool', () => {
  it('should persist conversation to SQLite and markdown', async () => {
    const tool = saveConversationTool({
      sqlite,
      markdown,
      vectorDb: mockVectorDb,
      generateEmbedding: stubEmbedding,
    });

    const result = await tool.execute('tc1', {
      title: 'API design chat',
      summary: 'We decided to use REST over GraphQL for simplicity.',
      tags: ['architecture', 'api'],
      category: 'planning',
    });

    // Result text
    expect(result.content[0]!.type).toBe('text');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('API design chat');
    expect(text).toContain('architecture, api');

    // SQLite record
    const id = (result.details as { id: string }).id;
    const row = sqlite.getNote(id);
    expect(row).toBeDefined();
    expect(row!.title).toBe('API design chat');
    expect(row!.type).toBe('conversation');
    expect(row!.status).toBe('read');
    expect(row!.category).toBe('planning');

    // Markdown file
    const note = markdown.readById(id);
    expect(note).toBeDefined();
    expect(note!.content).toBe('We decided to use REST over GraphQL for simplicity.');
    expect(note!.metadata.tags).toEqual(['architecture', 'api']);
  });

  it('defaults category to "conversations" when not provided', async () => {
    const tool = saveConversationTool({
      sqlite,
      markdown,
      vectorDb: mockVectorDb,
      generateEmbedding: stubEmbedding,
    });

    const result = await tool.execute('tc2', {
      title: 'Quick chat',
      summary: 'Nothing special.',
    });

    const id = (result.details as { id: string }).id;
    const row = sqlite.getNote(id);
    expect(row!.category).toBe('conversations');
  });

  it('proceeds without throwing when embedding fails', async () => {
    const failingEmbedding = async (): Promise<number[]> => {
      throw new Error('embedding service unavailable');
    };

    const tool = saveConversationTool({
      sqlite,
      markdown,
      vectorDb: mockVectorDb,
      generateEmbedding: failingEmbedding,
    });

    await expect(
      tool.execute('tc3', {
        title: 'Resilience test',
        summary: 'Embedding should not block persistence.',
      }),
    ).resolves.toBeDefined();

    // Note still persisted despite embedding failure
    const notes = sqlite.listNotes({ type: 'conversation' });
    expect(notes.length).toBe(1);
  });
});
