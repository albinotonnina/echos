import RSSParser from 'rss-parser';
import { v4 as uuidv4 } from 'uuid';
import type { Logger } from 'pino';
import { validateUrl } from '@echos/shared';
import { processArticle } from '@echos/plugin-article';
import type { PluginContext } from '@echos/core';
import type { NoteMetadata } from '@echos/shared';
import { categorizeContent } from '@echos/core';
import type { Feed, FeedEntry, FeedStore } from './feed-store.js';

const parser = new RSSParser({
  timeout: 30000,
  headers: { 'User-Agent': 'EchOS/1.0 (RSS Feed Reader)' },
});

export interface NewEntry {
  guid: string;
  url: string;
  title: string;
  publishedAt: string | null;
}

export async function pollFeed(feed: Feed, logger: Logger): Promise<NewEntry[]> {
  const validatedUrl = validateUrl(feed.url);

  let parsed: Awaited<ReturnType<typeof parser.parseURL>>;
  try {
    parsed = await parser.parseURL(validatedUrl);
  } catch (err) {
    throw new Error(`Failed to fetch feed "${feed.name}": ${err instanceof Error ? err.message : String(err)}`);
  }

  const newEntries: NewEntry[] = [];
  const lastEntryDate = feed.lastEntryDate ? new Date(feed.lastEntryDate) : null;

  for (const item of parsed.items) {
    const guid = item.guid ?? item.link ?? item.title ?? '';
    if (!guid) continue;

    const url = item.link ?? '';
    if (!url) continue;

    const title = item.title ?? 'Untitled';
    const pubDate = item.isoDate ?? item.pubDate ?? null;
    const publishedAt = pubDate ? new Date(pubDate).toISOString() : null;

    // Only include entries newer than lastEntryDate
    if (lastEntryDate && publishedAt) {
      const entryDate = new Date(publishedAt);
      if (entryDate <= lastEntryDate) continue;
    }

    newEntries.push({ guid, url, title, publishedAt });
  }

  logger.debug({ feedId: feed.id, name: feed.name, newCount: newEntries.length }, 'Feed polled');
  return newEntries;
}

export async function processEntry(
  entry: NewEntry,
  feed: Feed,
  store: FeedStore,
  context: PluginContext,
): Promise<void> {
  const { sqlite, markdown, vectorDb, generateEmbedding, logger, config } = context;

  // Validate and process URL
  let validatedUrl: string;
  try {
    validatedUrl = validateUrl(entry.url);
  } catch {
    logger.warn({ url: entry.url, feedId: feed.id }, 'Skipping entry with invalid URL');
    return;
  }

  let title = entry.title;
  let content = '';
  let author: string | undefined;

  // Try to extract article content
  try {
    const processed = await processArticle(validatedUrl, logger);
    title = processed.title || title;
    content = processed.content;
    author = processed.metadata.author;
  } catch (err) {
    // Fall back to minimal note if extraction fails
    logger.warn({ url: entry.url, err }, 'Article extraction failed, saving with minimal content');
    content = `*Source:* ${validatedUrl}\n\n*Feed:* ${feed.name}\n\n*Note:* Full content could not be extracted.`;
  }

  const now = new Date().toISOString();
  const id = uuidv4();

  // Auto-categorize with AI
  let category = 'articles';
  const tags = [...feed.tags, 'rss'];

  if (config.anthropicApiKey && content) {
    try {
      const vocabulary = sqlite.getTopTagsWithCounts(50);
      const result = await categorizeContent(
        title,
        content,
        'lightweight',
        config.anthropicApiKey as string,
        logger,
        undefined,
        config.defaultModel as string,
        undefined,
        vocabulary,
      );
      category = result.category;
      // Merge AI tags with feed tags, deduplicating
      const aiTags = result.tags.filter((t) => !tags.includes(t));
      tags.push(...aiTags);
    } catch {
      // Non-fatal — use defaults
    }
  }

  const metadata: NoteMetadata = {
    id,
    type: 'article',
    title,
    created: now,
    updated: now,
    tags,
    links: [],
    category,
    sourceUrl: validatedUrl,
    status: 'saved',
    inputSource: 'url',
  };
  if (author) metadata.author = author;

  const filePath = markdown.save(metadata, content);
  sqlite.upsertNote(metadata, content, filePath);

  // Embed
  if (content) {
    try {
      const embedText = `${title}\n\n${content.slice(0, 2000)}`;
      const vector = await generateEmbedding(embedText);
      await vectorDb.upsert({ id, text: embedText, vector, type: 'article', title });
    } catch {
      // Non-fatal
    }
  }

  // Record in feed_entries
  const feedEntry: FeedEntry = {
    id: uuidv4(),
    feedId: feed.id,
    guid: entry.guid,
    url: validatedUrl,
    title,
    publishedAt: entry.publishedAt,
    savedNoteId: id,
    createdAt: now,
  };
  store.insertEntry(feedEntry);

  logger.info({ feedId: feed.id, noteId: id, title }, 'Feed entry saved as note');
}
