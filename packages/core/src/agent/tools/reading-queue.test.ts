import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createReadingQueueTool } from './reading-queue.js';
import { createSqliteStorage, type SqliteStorage } from '../../storage/sqlite.js';
import { createLogger } from '@echos/shared';
import type { NoteMetadata } from '@echos/shared';

const logger = createLogger('test', 'silent');

let sqlite: SqliteStorage;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'echos-reading-queue-test-'));
  sqlite = createSqliteStorage(join(tempDir, 'test.db'), logger);
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function makeMeta(overrides: Partial<NoteMetadata> = {}): NoteMetadata {
  return {
    id: 'test-1',
    type: 'article',
    title: 'Test Article',
    created: '2024-01-01T00:00:00Z',
    updated: '2024-01-01T00:00:00Z',
    tags: [],
    links: [],
    category: 'general',
    status: 'saved',
    ...overrides,
  };
}

function callTool(params: Parameters<ReturnType<typeof createReadingQueueTool>['execute']>[1]) {
  const tool = createReadingQueueTool({ sqlite });
  return tool.execute('call-id', params, undefined as never, undefined);
}

function firstText(result: Awaited<ReturnType<typeof callTool>>): string {
  const item = result.content.find((c) => c.type === 'text');
  if (!item || !('text' in item)) throw new Error('No text content');
  return item.text;
}

describe('reading_queue — empty queue', () => {
  it('returns no-items message when queue is empty', async () => {
    const result = await callTool({});
    expect(firstText(result)).toContain('No unread items');
    expect(result.details).toMatchObject({ count: 0 });
  });

  it('includes type in no-items message when type filter is applied', async () => {
    const result = await callTool({ type: 'article' });
    expect(firstText(result)).toContain('No unread items');
    expect(firstText(result)).toContain('article');
  });
});

describe('reading_queue — with items', () => {
  beforeEach(() => {
    sqlite.upsertNote(makeMeta({ id: 'a1', type: 'article', title: 'Article 1', status: 'saved', created: '2024-01-01T00:00:00Z' }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'y1', type: 'youtube', title: 'Video 1', status: 'saved', created: '2024-01-02T00:00:00Z' }), '', '');
    sqlite.upsertNote(makeMeta({ id: 't1', type: 'tweet', title: 'Tweet 1', status: 'saved', created: '2024-01-03T00:00:00Z' }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'a2', type: 'article', title: 'Article 2', status: 'read', created: '2024-01-04T00:00:00Z' }), '', '');
  });

  it('lists only unread (saved) items', async () => {
    const result = await callTool({});
    const text = firstText(result);
    expect(text).toContain('Article 1');
    expect(text).toContain('Video 1');
    expect(text).toContain('Tweet 1');
    expect(text).not.toContain('Article 2'); // status=read, should be excluded
    expect(result.details).toMatchObject({ count: 3 });
  });

  it('filters by type', async () => {
    const result = await callTool({ type: 'article' });
    const text = firstText(result);
    expect(text).toContain('Article 1');
    expect(text).not.toContain('Video 1');
    expect(text).not.toContain('Tweet 1');
    expect(result.details).toMatchObject({ count: 1 });
  });

  it('respects the limit parameter', async () => {
    const result = await callTool({ limit: 2 });
    expect(result.details).toMatchObject({ count: 2 });
  });

  it('returns all items when limit exceeds queue size', async () => {
    const result = await callTool({ limit: 100 });
    expect(result.details).toMatchObject({ count: 3 });
  });
});

describe('reading_queue — details.items shape', () => {
  it('propagates sourceUrl into details.items when set', async () => {
    sqlite.upsertNote(
      makeMeta({ id: 'with-url', title: 'Has URL', status: 'saved', sourceUrl: 'https://example.com/article' }),
      '', '',
    );
    const result = await callTool({});
    const items = (result.details as { items: Array<{ id: string; sourceUrl?: string }> }).items;
    const item = items.find((i) => i.id === 'with-url');
    expect(item?.sourceUrl).toBe('https://example.com/article');
  });

  it('omits sourceUrl from details.items (undefined) when not set', async () => {
    sqlite.upsertNote(
      makeMeta({ id: 'no-url', title: 'No URL', status: 'saved' }),
      '', '',
    );
    const result = await callTool({});
    const items = (result.details as { items: Array<{ id: string; sourceUrl?: string }> }).items;
    const item = items.find((i) => i.id === 'no-url');
    expect(item?.sourceUrl).toBeUndefined();
  });
});

describe('reading_queue — relevance sorting', () => {
  it('falls back to recency order when there are no recent reads', async () => {
    // saved oldest → newest: old, mid, new
    sqlite.upsertNote(makeMeta({ id: 'old', title: 'Old Article', tags: ['typescript'], status: 'saved', created: '2024-01-01T00:00:00Z', updated: '2024-01-01T00:00:00Z' }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'mid', title: 'Mid Article', tags: [], status: 'saved', created: '2024-02-01T00:00:00Z', updated: '2024-02-01T00:00:00Z' }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'new', title: 'New Article', tags: [], status: 'saved', created: '2024-03-01T00:00:00Z', updated: '2024-03-01T00:00:00Z' }), '', '');

    const result = await callTool({});
    const items = (result.details as { items: { id: string }[] }).items;
    // With no interest profile, pure recency — newest first
    expect(items[0]?.id).toBe('new');
    expect(items[1]?.id).toBe('mid');
    expect(items[2]?.id).toBe('old');
  });

  it('surfaces item with matching tags above a newer item with no overlap', async () => {
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days ago

    // Add 3 recent reads to trigger relevance note (≥3) and build interest profile with 'typescript' tag
    sqlite.upsertNote(makeMeta({ id: 'r1', title: 'Read 1', tags: ['typescript'], category: 'tech', status: 'read', updated: recentDate, created: recentDate }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'r2', title: 'Read 2', tags: ['typescript'], category: 'tech', status: 'read', updated: recentDate, created: recentDate }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'r3', title: 'Read 3', tags: ['typescript'], category: 'tech', status: 'read', updated: recentDate, created: recentDate }), '', '');

    // Unread: 'old-relevant' saved 30 days ago with matching tags, 'new-irrelevant' saved yesterday with no matching tags
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const yesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

    sqlite.upsertNote(makeMeta({ id: 'old-relevant', title: 'Old Relevant', tags: ['typescript'], category: 'tech', status: 'saved', created: thirtyDaysAgo, updated: thirtyDaysAgo }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'new-irrelevant', title: 'New Irrelevant', tags: ['cooking'], category: 'food', status: 'saved', created: yesterday, updated: yesterday }), '', '');

    const result = await callTool({});
    const items = (result.details as { items: { id: string }[] }).items;
    const ids = items.map((i) => i.id);
    expect(ids.indexOf('old-relevant')).toBeLessThan(ids.indexOf('new-irrelevant'));

    // Relevance note should appear since ≥3 recent reads
    expect(firstText(result)).toContain('Sorted by relevance');
  });

  it('does not show relevance note when fewer than 3 recent reads', async () => {
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    // Only 2 recent reads — below the threshold
    sqlite.upsertNote(makeMeta({ id: 'r1', title: 'Read 1', tags: ['ts'], status: 'read', updated: recentDate, created: recentDate }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'r2', title: 'Read 2', tags: ['ts'], status: 'read', updated: recentDate, created: recentDate }), '', '');
    sqlite.upsertNote(makeMeta({ id: 's1', title: 'Saved 1', tags: ['ts'], status: 'saved', created: recentDate, updated: recentDate }), '', '');

    const result = await callTool({});
    expect(firstText(result)).not.toContain('Sorted by relevance');
  });

  it('type filter still applies after relevance sorting', async () => {
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    sqlite.upsertNote(makeMeta({ id: 'r1', title: 'Read 1', tags: ['ts'], status: 'read', updated: recentDate, created: recentDate }), '', '');

    sqlite.upsertNote(makeMeta({ id: 'art1', type: 'article', title: 'Article With Tag', tags: ['ts'], status: 'saved', created: recentDate, updated: recentDate }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'vid1', type: 'youtube', title: 'Video', tags: ['ts'], status: 'saved', created: recentDate, updated: recentDate }), '', '');

    const result = await callTool({ type: 'article' });
    const text = firstText(result);
    expect(text).toContain('Article With Tag');
    expect(text).not.toContain('Video');
    expect(result.details).toMatchObject({ count: 1 });
  });
});
