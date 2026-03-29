import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { v4 as uuidv4 } from 'uuid';
import type { PluginContext } from '@echos/core';
import { validateUrl } from '@echos/shared';
import RSSParser from 'rss-parser';
import type { FeedStore } from './feed-store.js';
import { pollFeed, processEntry } from './poller.js';

const parser = new RSSParser({
  timeout: 30000,
  headers: { 'User-Agent': 'EchOS/1.0 (RSS Feed Reader)' },
});

const schema = Type.Object({
  action: Type.Union(
    [
      Type.Literal('add'),
      Type.Literal('list'),
      Type.Literal('remove'),
      Type.Literal('refresh'),
    ],
    {
      description: 'Action to perform: add/list/remove/refresh feed subscriptions',
    },
  ),
  url: Type.Optional(
    Type.String({
      description: 'Feed URL (required for add/remove/refresh of a specific feed)',
      format: 'uri',
    }),
  ),
  name: Type.Optional(
    Type.String({ description: 'Display name for the feed (used with add)' }),
  ),
  tags: Type.Optional(
    Type.Array(Type.String(), { description: 'Tags to apply to all articles from this feed' }),
  ),
});

type Params = Static<typeof schema>;

function ok(text: string, details?: Record<string, unknown>): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text }],
    details: details ?? {},
  };
}

function err(text: string): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text }],
    details: {},
  };
}

export function createManageFeedsTool(
  context: PluginContext,
  store: FeedStore,
): AgentTool<typeof schema> {
  return {
    name: 'manage_feeds',
    label: 'Manage RSS Feeds',
    description:
      'Subscribe to, list, remove, or refresh RSS/Atom feed subscriptions. New entries are saved automatically every 4 hours.',
    parameters: schema,
    execute: async (_toolCallId: string, params: Params) => {
      switch (params.action) {
        case 'add':
          return handleAdd(params, context, store);
        case 'list':
          return handleList(store);
        case 'remove':
          return handleRemove(params, store);
        case 'refresh':
          return handleRefresh(params, context, store);
      }
    },
  };
}

async function handleAdd(
  params: Params,
  context: PluginContext,
  store: FeedStore,
): Promise<AgentToolResult<unknown>> {
  if (!params.url) {
    return err('Error: url is required for add action');
  }

  let validatedUrl: string;
  try {
    validatedUrl = validateUrl(params.url);
  } catch {
    return err(`Error: Invalid URL: ${params.url}`);
  }

  // Check for duplicate
  const existing = store.getFeedByUrl(validatedUrl);
  if (existing) {
    return ok(`Feed already subscribed: "${existing.name}" (${validatedUrl})`);
  }

  // Parse feed to validate and get title
  let feedTitle: string;
  try {
    const parsed = await parser.parseURL(validatedUrl);
    feedTitle = parsed.title ?? parsed.description ?? params.url;
  } catch (e) {
    return err(
      `Error: Could not parse feed at ${validatedUrl}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const name = params.name ?? feedTitle;
  const tags = params.tags ?? [];
  const now = new Date().toISOString();

  const feed = {
    id: uuidv4(),
    url: validatedUrl,
    name,
    tags,
    lastCheckedAt: null,
    lastEntryDate: null,
    createdAt: now,
  };

  store.upsertFeed(feed);
  context.logger.info({ feedId: feed.id, url: validatedUrl, name }, 'RSS feed subscribed');

  return ok(
    `Subscribed to feed "${name}" (${validatedUrl})\nTags: [${tags.join(', ')}]\nNew articles will be saved every 4 hours. Use action: "refresh" to fetch immediately.`,
    { id: feed.id, name, url: validatedUrl },
  );
}

function handleList(store: FeedStore): AgentToolResult<unknown> {
  const feeds = store.listFeeds();

  if (feeds.length === 0) {
    return ok('No RSS feeds subscribed. Use action: "add" with a feed URL to subscribe.');
  }

  const lines = feeds.map((f) => {
    const checked = f.lastCheckedAt ? new Date(f.lastCheckedAt).toLocaleString() : 'never';
    const count = store.getEntryCount(f.id);
    const tags = f.tags.length > 0 ? ` [${f.tags.join(', ')}]` : '';
    return `• ${f.name}${tags}\n  URL: ${f.url}\n  Last checked: ${checked} | Saved entries: ${count}`;
  });

  return ok(
    `Subscribed RSS feeds (${feeds.length}):\n\n${lines.join('\n\n')}`,
    { feeds: feeds.map((f) => ({ id: f.id, name: f.name, url: f.url })) },
  );
}

function handleRemove(params: Params, store: FeedStore): AgentToolResult<unknown> {
  if (!params.url) {
    return err('Error: url is required for remove action');
  }

  const feed = store.getFeedByUrl(params.url);
  if (!feed) {
    return ok(`No feed found with URL: ${params.url}`);
  }

  store.deleteFeed(feed.id);

  return ok(
    `Unsubscribed from feed "${feed.name}" (${feed.url})\nNote: previously saved articles are retained.`,
    { id: feed.id, name: feed.name },
  );
}

async function handleRefresh(
  params: Params,
  context: PluginContext,
  store: FeedStore,
): Promise<AgentToolResult<unknown>> {
  const { logger } = context;
  const allFeeds = params.url
    ? [store.getFeedByUrl(params.url)].filter((f): f is NonNullable<typeof f> => f !== undefined)
    : store.listFeeds();

  if (allFeeds.length === 0) {
    const msg = params.url
      ? `No feed found with URL: ${params.url}`
      : 'No RSS feeds subscribed. Use action: "add" to subscribe to a feed.';
    return ok(msg);
  }

  const results: string[] = [];

  for (const feed of allFeeds) {
    try {
      const newEntries = await pollFeed(feed, logger);
      const now = new Date().toISOString();

      if (newEntries.length === 0) {
        store.updateLastChecked(feed.id, now);
        results.push(`${feed.name}: no new entries`);
        continue;
      }

      const sorted = [...newEntries].sort((a, b) => {
        if (!a.publishedAt) return 1;
        if (!b.publishedAt) return -1;
        return new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime();
      });

      let saved = 0;
      let latestDate = feed.lastEntryDate;

      for (const entry of sorted) {
        if (store.hasEntry(feed.id, entry.guid)) continue;
        try {
          await processEntry(entry, feed, store, context);
          saved++;
          if (entry.publishedAt && (!latestDate || entry.publishedAt > latestDate)) {
            latestDate = entry.publishedAt;
          }
        } catch (e) {
          logger.error({ feedId: feed.id, url: entry.url, err: e }, 'Failed to process entry during refresh');
        }
      }

      store.updateLastChecked(feed.id, now, latestDate ?? undefined);
      results.push(`${feed.name}: saved ${saved} new article${saved === 1 ? '' : 's'}`);
    } catch (e) {
      results.push(`${feed.name}: error — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return ok(`RSS refresh complete:\n${results.map((r) => `• ${r}`).join('\n')}`);
}
