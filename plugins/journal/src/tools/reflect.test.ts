import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { createReflectTool } from './reflect.js';
import type { PluginContext } from '@echos/core';

// Mock createEchosAgent at module level
vi.mock('@echos/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@echos/core')>();
  return {
    ...original,
    createEchosAgent: vi.fn(() => ({
      subscribe: vi.fn((cb: (event: unknown) => void) => {
        // Simulate text output after a tick
        queueMicrotask(() => {
          cb({
            type: 'message_update',
            assistantMessageEvent: {
              type: 'text_delta',
              delta: 'This is a reflection summary.',
            },
          });
        });
        return () => {};
      }),
      prompt: vi.fn(async () => {}),
    })),
  };
});

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
    getAgentDeps: () => ({}) as never,
    getNotificationService: () => ({ async sendMessage() {}, async broadcast() {} }),
    config: {},
  };
}

function createJournalEntry(title: string, content: string, daysAgo: number): void {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const now = date.toISOString();
  const id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const metadata = {
    id,
    type: 'journal' as const,
    title,
    created: now,
    updated: now,
    tags: [] as string[],
    links: [] as string[],
    category: 'uncategorized',
    status: 'read' as const,
    inputSource: 'text' as const,
  };

  const filePath = markdown.save(metadata, content);
  sqlite.upsertNote(metadata, content, filePath);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'echos-reflect-test-'));
  sqlite = createSqliteStorage(join(tempDir, 'test.db'), logger);
  markdown = createMarkdownStorage(join(tempDir, 'knowledge'), logger);
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('reflect tool', () => {
  it('should return "no entries" message when no journal entries exist', async () => {
    const tool = createReflectTool(makeContext());

    const result = await tool.execute('tc1', {});

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('No journal entries found');
  });

  it('should return "no entries" for month period with no entries', async () => {
    const tool = createReflectTool(makeContext());

    const result = await tool.execute('tc2', { period: 'month' });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('No journal entries found');
    expect(text).toContain('month');
  });

  it('should find journal entries within the week period', async () => {
    createJournalEntry('Monday Thoughts', 'Had a productive day.', 2);
    createJournalEntry('Wednesday Reflection', 'Feeling grateful.', 1);

    const tool = createReflectTool(makeContext());
    const result = await tool.execute('tc3', { period: 'week' });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    // The mock agent returns reflection text
    expect(text).toContain('reflection summary');
  });

  it('should reject invalid date ranges (dateFrom > dateTo)', async () => {
    const tool = createReflectTool(makeContext());

    const result = await tool.execute('tc4', {
      period: 'custom',
      dateFrom: '2025-12-31',
      dateTo: '2025-01-01',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('dateFrom must be before dateTo');
  });

  it('should reject date ranges exceeding 365 days', async () => {
    const tool = createReflectTool(makeContext());

    const result = await tool.execute('tc5', {
      period: 'custom',
      dateFrom: '2023-01-01',
      dateTo: '2025-01-01',
    });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('cannot exceed 365 days');
  });

  it('should not find entries outside the date range', async () => {
    // Create entry 20 days ago — outside the 7-day default
    createJournalEntry('Old Entry', 'From a while back.', 20);

    const tool = createReflectTool(makeContext());
    const result = await tool.execute('tc6', { period: 'week' });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('No journal entries found');
  });
});
