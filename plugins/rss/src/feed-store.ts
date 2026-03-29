import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS feeds (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  last_checked_at TEXT,
  last_entry_date TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feed_entries (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  guid TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at TEXT,
  saved_note_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(feed_id, guid)
);

CREATE INDEX IF NOT EXISTS idx_feed_entries_feed_id ON feed_entries(feed_id);
CREATE INDEX IF NOT EXISTS idx_feed_entries_guid ON feed_entries(feed_id, guid);
`;

export interface Feed {
  id: string;
  url: string;
  name: string;
  tags: string[];
  lastCheckedAt: string | null;
  lastEntryDate: string | null;
  createdAt: string;
}

export interface FeedEntry {
  id: string;
  feedId: string;
  guid: string;
  url: string;
  title: string;
  publishedAt: string | null;
  savedNoteId: string | null;
  createdAt: string;
}

function rowToFeed(row: Record<string, unknown>): Feed {
  return {
    id: row['id'] as string,
    url: row['url'] as string,
    name: row['name'] as string,
    tags: JSON.parse(row['tags'] as string) as string[],
    lastCheckedAt: (row['last_checked_at'] as string | null) ?? null,
    lastEntryDate: (row['last_entry_date'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
  };
}

function rowToEntry(row: Record<string, unknown>): FeedEntry {
  return {
    id: row['id'] as string,
    feedId: row['feed_id'] as string,
    guid: row['guid'] as string,
    url: row['url'] as string,
    title: row['title'] as string,
    publishedAt: (row['published_at'] as string | null) ?? null,
    savedNoteId: (row['saved_note_id'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
  };
}

export interface FeedStore {
  upsertFeed(feed: Feed): void;
  getFeed(id: string): Feed | undefined;
  getFeedByUrl(url: string): Feed | undefined;
  listFeeds(): Feed[];
  deleteFeed(id: string): boolean;
  updateLastChecked(id: string, lastCheckedAt: string, lastEntryDate?: string): void;
  hasEntry(feedId: string, guid: string): boolean;
  insertEntry(entry: FeedEntry): void;
  getEntryCount(feedId: string): number;
  close(): void;
}

export function createFeedStore(dbPath: string): FeedStore {
  const dir = dirname(dbPath);
  mkdirSync(join(dir), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  return {
    upsertFeed(feed: Feed): void {
      db.prepare(
        `INSERT INTO feeds (id, url, name, tags, last_checked_at, last_entry_date, created_at)
         VALUES (@id, @url, @name, @tags, @lastCheckedAt, @lastEntryDate, @createdAt)
         ON CONFLICT(id) DO UPDATE SET
           url=excluded.url, name=excluded.name, tags=excluded.tags,
           last_checked_at=excluded.last_checked_at, last_entry_date=excluded.last_entry_date`,
      ).run({
        id: feed.id,
        url: feed.url,
        name: feed.name,
        tags: JSON.stringify(feed.tags),
        lastCheckedAt: feed.lastCheckedAt,
        lastEntryDate: feed.lastEntryDate,
        createdAt: feed.createdAt,
      });
    },

    getFeed(id: string): Feed | undefined {
      const row = db.prepare('SELECT * FROM feeds WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      return row ? rowToFeed(row) : undefined;
    },

    getFeedByUrl(url: string): Feed | undefined {
      const row = db.prepare('SELECT * FROM feeds WHERE url = ?').get(url) as Record<string, unknown> | undefined;
      return row ? rowToFeed(row) : undefined;
    },

    listFeeds(): Feed[] {
      const rows = db.prepare('SELECT * FROM feeds ORDER BY created_at ASC').all() as Record<string, unknown>[];
      return rows.map(rowToFeed);
    },

    deleteFeed(id: string): boolean {
      const info = db.prepare('DELETE FROM feeds WHERE id = ?').run(id);
      return info.changes > 0;
    },

    updateLastChecked(id: string, lastCheckedAt: string, lastEntryDate?: string): void {
      if (lastEntryDate !== undefined) {
        db.prepare(
          'UPDATE feeds SET last_checked_at = ?, last_entry_date = ? WHERE id = ?',
        ).run(lastCheckedAt, lastEntryDate, id);
      } else {
        db.prepare('UPDATE feeds SET last_checked_at = ? WHERE id = ?').run(lastCheckedAt, id);
      }
    },

    hasEntry(feedId: string, guid: string): boolean {
      const row = db
        .prepare('SELECT 1 FROM feed_entries WHERE feed_id = ? AND guid = ?')
        .get(feedId, guid);
      return row !== undefined;
    },

    insertEntry(entry: FeedEntry): void {
      db.prepare(
        `INSERT OR IGNORE INTO feed_entries
           (id, feed_id, guid, url, title, published_at, saved_note_id, created_at)
         VALUES (@id, @feedId, @guid, @url, @title, @publishedAt, @savedNoteId, @createdAt)`,
      ).run({
        id: entry.id,
        feedId: entry.feedId,
        guid: entry.guid,
        url: entry.url,
        title: entry.title,
        publishedAt: entry.publishedAt,
        savedNoteId: entry.savedNoteId,
        createdAt: entry.createdAt,
      });
    },

    getEntryCount(feedId: string): number {
      const row = db
        .prepare('SELECT COUNT(*) as count FROM feed_entries WHERE feed_id = ?')
        .get(feedId) as { count: number };
      return row.count;
    },

    close(): void {
      db.close();
    },
  };
}
