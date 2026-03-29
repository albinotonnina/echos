import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createKnowledgeStatsTool } from './knowledge-stats.js';
import { createSqliteStorage, type SqliteStorage } from '../../storage/sqlite.js';
import { createLogger } from '@echos/shared';
import type { NoteMetadata } from '@echos/shared';

const logger = createLogger('test', 'silent');

let sqlite: SqliteStorage;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'echos-knowledge-stats-test-'));
  sqlite = createSqliteStorage(join(tempDir, 'test.db'), logger);
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function makeMeta(overrides: Partial<NoteMetadata> = {}): NoteMetadata {
  return {
    id: 'test-1',
    type: 'note',
    title: 'Test Note',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    tags: [],
    links: [],
    category: '',
    ...overrides,
  };
}

function callTool() {
  const tool = createKnowledgeStatsTool({ sqlite, knowledgeDir: tempDir, dbPath: tempDir });
  return tool.execute('call-id', {}, undefined as never, undefined);
}

function firstText(result: Awaited<ReturnType<typeof callTool>>): string {
  const item = result.content.find((c) => c.type === 'text');
  if (!item || !('text' in item)) throw new Error('No text content');
  return item.text;
}

describe('knowledge_stats — empty database', () => {
  it('returns zero totals', async () => {
    const result = await callTool();
    expect(result.details).toMatchObject({
      totalNotes: 0,
      totalDistinctTags: 0,
      totalLinks: 0,
      statusSaved: 0,
      statusRead: 0,
      statusArchived: 0,
      statusUnset: 0,
    });
  });

  it('returns 8 weekly buckets all zero', async () => {
    const result = await callTool();
    expect(result.details.weeklyGrowth).toHaveLength(8);
    for (const w of result.details.weeklyGrowth as { week: string; count: number }[]) {
      expect(w.count).toBe(0);
    }
  });

  it('returns zero streaks', async () => {
    const result = await callTool();
    expect(result.details.streaks).toEqual({ currentStreak: 0, longestStreak: 0 });
  });

  it('includes section headers in output', async () => {
    const text = firstText(await callTool());
    expect(text).toContain('Knowledge Base Overview');
    expect(text).toContain('By Type');
    expect(text).toContain('By Status');
    expect(text).toContain('Weekly Growth');
    expect(text).toContain('Storage');
  });
});

describe('knowledge_stats — note counts by type', () => {
  beforeEach(() => {
    sqlite.upsertNote(makeMeta({ id: 'n1', type: 'note' }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'n2', type: 'note' }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'a1', type: 'article' }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'y1', type: 'youtube' }), '', '');
  });

  it('counts total notes', async () => {
    const result = await callTool();
    expect(result.details.totalNotes).toBe(4);
  });

  it('breaks down counts by type', async () => {
    const result = await callTool();
    const byType = result.details.byType as Record<string, number>;
    expect(byType['note']).toBe(2);
    expect(byType['article']).toBe(1);
    expect(byType['youtube']).toBe(1);
  });

  it('excludes deleted notes from total', async () => {
    sqlite.upsertNote(makeMeta({ id: 'del1', type: 'note', status: 'deleted' }), '', '');
    const result = await callTool();
    expect(result.details.totalNotes).toBe(4);
  });
});

describe('knowledge_stats — status breakdown', () => {
  it('counts all four status buckets correctly', async () => {
    sqlite.upsertNote(makeMeta({ id: 's1', status: 'saved' }), '', '');
    sqlite.upsertNote(makeMeta({ id: 's2', status: 'saved' }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'r1', status: 'read' }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'ar1', status: 'archived' }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'u1' }), '', '');
    const result = await callTool();
    expect(result.details).toMatchObject({
      statusSaved: 2,
      statusRead: 1,
      statusArchived: 1,
      statusUnset: 1,
    });
  });
});

describe('knowledge_stats — distinct tags and links', () => {
  it('counts distinct tags across notes', async () => {
    sqlite.upsertNote(makeMeta({ id: 'n1', tags: ['typescript', 'javascript'] }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'n2', tags: ['typescript', 'rust'] }), '', '');
    const result = await callTool();
    // 3 distinct tags: typescript, javascript, rust
    expect(result.details.totalDistinctTags).toBe(3);
  });

  it('counts comma-separated links', async () => {
    sqlite.upsertNote(makeMeta({ id: 'n1', links: ['id-a', 'id-b'] }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'n2', links: ['id-c'] }), '', '');
    const result = await callTool();
    expect(result.details.totalLinks).toBe(3);
  });

  it('handles notes with no tags or links', async () => {
    sqlite.upsertNote(makeMeta({ id: 'n1', tags: [], links: [] }), '', '');
    const result = await callTool();
    expect(result.details.totalDistinctTags).toBe(0);
    expect(result.details.totalLinks).toBe(0);
  });
});

describe('knowledge_stats — weekly growth sparkline', () => {
  it('notes created this week appear in the most-recent bucket', async () => {
    sqlite.upsertNote(makeMeta({ id: 'n1', created: new Date().toISOString() }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'n2', created: new Date().toISOString() }), '', '');
    const result = await callTool();
    const weeks = result.details.weeklyGrowth as { week: string; count: number }[];
    const lastBucket = weeks[weeks.length - 1];
    expect(lastBucket?.count).toBe(2);
  });

  it('notes older than 8 weeks do not appear in any bucket', async () => {
    const old = new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString();
    sqlite.upsertNote(makeMeta({ id: 'n1', created: old }), '', '');
    const result = await callTool();
    const weeks = result.details.weeklyGrowth as { week: string; count: number }[];
    const total = weeks.reduce((sum, w) => sum + w.count, 0);
    expect(total).toBe(0);
  });

  it('week strings match SQLite strftime format YYYY-WNN', async () => {
    sqlite.upsertNote(makeMeta({ id: 'n1', created: new Date().toISOString() }), '', '');
    const result = await callTool();
    const weeks = result.details.weeklyGrowth as { week: string; count: number }[];
    for (const w of weeks) {
      expect(w.week).toMatch(/^\d{4}-W\d{2}$/);
    }
  });
});

describe('knowledge_stats — activity streaks', () => {
  it('current streak is 0 when no notes this week', async () => {
    const old = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    sqlite.upsertNote(makeMeta({ id: 'n1', created: old }), '', '');
    const result = await callTool();
    expect(result.details.streaks).toMatchObject({ currentStreak: 0 });
  });

  it('current streak counts consecutive recent weeks', async () => {
    // Insert notes in this week and last week
    const thisWeek = new Date().toISOString();
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    sqlite.upsertNote(makeMeta({ id: 'n1', created: thisWeek }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'n2', created: lastWeek }), '', '');
    const result = await callTool();
    expect(result.details.streaks.currentStreak).toBeGreaterThanOrEqual(1);
  });

  it('longest streak is at least as large as current streak', async () => {
    sqlite.upsertNote(makeMeta({ id: 'n1', created: new Date().toISOString() }), '', '');
    const result = await callTool();
    const { currentStreak, longestStreak } = result.details.streaks as {
      currentStreak: number;
      longestStreak: number;
    };
    expect(longestStreak).toBeGreaterThanOrEqual(currentStreak);
  });
});

describe('knowledge_stats — top tags and categories', () => {
  it('returns top tags sorted by frequency', async () => {
    sqlite.upsertNote(makeMeta({ id: 'n1', tags: ['typescript', 'javascript'] }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'n2', tags: ['typescript'] }), '', '');
    const result = await callTool();
    const topTags = result.details.topTags as { tag: string; count: number }[];
    expect(topTags[0]?.tag).toBe('typescript');
    expect(topTags[0]?.count).toBe(2);
  });

  it('returns top categories sorted by frequency', async () => {
    sqlite.upsertNote(makeMeta({ id: 'n1', category: 'engineering' }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'n2', category: 'engineering' }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'n3', category: 'design' }), '', '');
    const result = await callTool();
    const topCats = result.details.topCategories as { category: string; count: number }[];
    expect(topCats[0]?.category).toBe('engineering');
    expect(topCats[0]?.count).toBe(2);
  });
});
