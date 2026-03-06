import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createReadingStatsTool } from './reading-stats.js';
import { createSqliteStorage, type SqliteStorage } from '../../storage/sqlite.js';
import { createLogger } from '@echos/shared';
import type { NoteMetadata } from '@echos/shared';

const logger = createLogger('test', 'silent');

let sqlite: SqliteStorage;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'echos-reading-stats-test-'));
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
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    tags: [],
    links: [],
    category: 'general',
    status: 'saved',
    ...overrides,
  };
}

function callTool() {
  const tool = createReadingStatsTool({ sqlite });
  return tool.execute('call-id', {}, undefined as never, undefined);
}

function firstText(result: Awaited<ReturnType<typeof callTool>>): string {
  const item = result.content.find((c) => c.type === 'text');
  if (!item || !('text' in item)) throw new Error('No text content');
  return item.text;
}

describe('reading_stats — empty database', () => {
  it('returns zero counts and 0% read rate', async () => {
    const result = await callTool();
    expect(result.details).toMatchObject({
      totalSaved: 0,
      totalRead: 0,
      totalArchived: 0,
      readRate: 0,
      recentSaves: 0,
      recentReads: 0,
    });
  });

  it('excludes non-saveable types (note, journal) from counts', async () => {
    sqlite.upsertNote(makeMeta({ id: 'n1', type: 'note', status: 'read' }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'n2', type: 'journal', status: 'saved' }), '', '');
    const result = await callTool();
    expect(result.details).toMatchObject({ totalSaved: 0, totalRead: 0, totalArchived: 0 });
  });
});

describe('reading_stats — with mixed content', () => {
  beforeEach(() => {
    sqlite.upsertNote(makeMeta({ id: 'a1', type: 'article', status: 'saved' }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'a2', type: 'article', status: 'read' }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'a3', type: 'article', status: 'archived' }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'y1', type: 'youtube', status: 'saved' }), '', '');
    sqlite.upsertNote(makeMeta({ id: 'y2', type: 'youtube', status: 'read' }), '', '');
    sqlite.upsertNote(makeMeta({ id: 't1', type: 'tweet', status: 'saved' }), '', '');
  });

  it('counts saved/read/archived correctly', async () => {
    const result = await callTool();
    expect(result.details).toMatchObject({
      totalSaved: 3,
      totalRead: 2,
      totalArchived: 1,
    });
  });

  it('computes read rate correctly', async () => {
    const result = await callTool();
    // 2 read / 6 total = 33%
    expect(result.details).toMatchObject({ readRate: 33 });
  });

  it('breaks down counts by type', async () => {
    const result = await callTool();
    const byType = result.details.byType as Record<string, { saved: number; read: number; archived: number }>;
    expect(byType['article']).toEqual({ saved: 1, read: 1, archived: 1 });
    expect(byType['youtube']).toEqual({ saved: 1, read: 1, archived: 0 });
    expect(byType['tweet']).toEqual({ saved: 1, read: 0, archived: 0 });
  });

  it('includes summary text in output', async () => {
    const text = firstText(await callTool());
    expect(text).toContain('Reading Stats');
    expect(text).toContain('Read rate:');
    expect(text).toContain('By type:');
  });
});

describe('reading_stats — recentSaves counts all saves regardless of current status', () => {
  it('counts items saved in last 7 days even if they have since been read', async () => {
    const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    sqlite.upsertNote(makeMeta({ id: 'a1', type: 'article', status: 'read', created: recentDate }), '', '');
    const result = await callTool();
    // Item was saved recently (created within 7 days) and then read — should still count as a recent save
    expect(result.details).toMatchObject({ recentSaves: 1 });
  });

  it('does not count old items in recentSaves', async () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    sqlite.upsertNote(makeMeta({ id: 'a1', type: 'article', status: 'saved', created: oldDate }), '', '');
    const result = await callTool();
    expect(result.details).toMatchObject({ recentSaves: 0 });
  });
});

describe('reading_stats — recentReads', () => {
  it('counts items marked read within last 7 days', async () => {
    sqlite.upsertNote(makeMeta({ id: 'a1', type: 'article', status: 'read' }), '', '');
    const result = await callTool();
    expect(result.details).toMatchObject({ recentReads: 1 });
  });
});
