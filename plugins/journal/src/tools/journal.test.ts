import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createLogger } from '@echos/shared';
import {
  createSqliteStorage,
  type SqliteStorage,
  createMarkdownStorage,
  type MarkdownStorage,
} from '@echos/core';
import { createJournalTool } from './journal.js';
import type { PluginContext } from '@echos/core';

const logger = createLogger('test', 'silent');

let tempDir: string;
let sqlite: SqliteStorage;
let markdown: MarkdownStorage;

const mockVectorDb = {
  upsert: async () => {},
  search: async () => [],
  findByVector: async () => [],
  remove: async () => {},
  close: () => {},
};

const stubEmbedding = async () => new Array(1536).fill(0);

function makeContext(): PluginContext {
  return {
    sqlite,
    markdown,
    vectorDb: mockVectorDb,
    generateEmbedding: stubEmbedding,
    logger,
    getAgentDeps: () => undefined as never,
    getNotificationService: () => ({ async sendMessage() {}, async broadcast() {} }),
    config: {},
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'echos-journal-test-'));
  sqlite = createSqliteStorage(join(tempDir, 'test.db'), logger);
  markdown = createMarkdownStorage(join(tempDir, 'knowledge'), logger);
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('journal tool', () => {
  it('should create a journal entry and persist it to all stores', async () => {
    const tool = createJournalTool(makeContext());

    const result = await tool.execute('tc1', {
      title: 'Morning Thoughts',
      content: 'Feeling energized today after a good sleep.',
      tags: ['morning', 'wellness'],
      category: 'health',
    });

    expect(result.content[0]!.type).toBe('text');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Created journal entry "Morning Thoughts"');
    expect(text).toContain('morning, wellness');

    const id = (result.details as { id: string }).id;
    const row = sqlite.getNote(id);
    expect(row).toBeDefined();
    expect(row!.title).toBe('Morning Thoughts');
    expect(row!.type).toBe('journal');
    expect(row!.category).toBe('health');

    const note = markdown.readById(id);
    expect(note).toBeDefined();
    expect(note!.content).toBe('Feeling energized today after a good sleep.');
    expect(note!.metadata.tags).toEqual(['morning', 'wellness']);
  });

  it('should default category to "uncategorized" and inputSource to "text"', async () => {
    const tool = createJournalTool(makeContext());

    const result = await tool.execute('tc2', {
      title: 'Quick Note',
      content: 'Just a thought.',
    });

    const id = (result.details as { id: string }).id;
    const row = sqlite.getNote(id);
    expect(row!.type).toBe('journal');
    expect(row!.category).toBe('uncategorized');
    expect(row!.inputSource).toBe('text');
  });

  it('should set inputSource when provided', async () => {
    const tool = createJournalTool(makeContext());

    const result = await tool.execute('tc3', {
      title: 'Voice Journal',
      content: 'Transcribed from voice.',
      inputSource: 'voice',
    });

    const id = (result.details as { id: string }).id;
    const row = sqlite.getNote(id);
    expect(row!.inputSource).toBe('voice');
  });

  it('should set status to "read"', async () => {
    const tool = createJournalTool(makeContext());

    const result = await tool.execute('tc4', {
      title: 'Status Test',
      content: 'Checking status.',
    });

    const id = (result.details as { id: string }).id;
    const row = sqlite.getNote(id);
    expect(row!.status).toBe('read');
  });
});
