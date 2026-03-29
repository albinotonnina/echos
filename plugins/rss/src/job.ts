import type { PluginContext, ScheduledJob } from '@echos/core';
import type { FeedStore } from './feed-store.js';
import { pollFeed, processEntry } from './poller.js';

export const RSS_POLL_JOB_TYPE = 'rss_poll';
export const RSS_POLL_SCHEDULE_ID = 'rss-poll';
export const RSS_POLL_DEFAULT_CRON = '0 */4 * * *';

export function createRssPollJob(context: PluginContext, store: FeedStore): ScheduledJob {
  return {
    type: RSS_POLL_JOB_TYPE,
    description: 'Polls all subscribed RSS/Atom feeds for new entries',
    processor: async (_job, _config) => {
      const { logger } = context;
      const feeds = store.listFeeds();

      if (feeds.length === 0) {
        logger.debug('No RSS feeds subscribed, skipping poll');
        return;
      }

      logger.info({ feedCount: feeds.length }, 'Starting RSS feed poll');

      for (const feed of feeds) {
        try {
          const newEntries = await pollFeed(feed, logger);
          const now = new Date().toISOString();

          if (newEntries.length === 0) {
            store.updateLastChecked(feed.id, now);
            continue;
          }

          // Process entries oldest-first so lastEntryDate advances correctly
          const sorted = [...newEntries].sort((a, b) => {
            if (!a.publishedAt) return 1;
            if (!b.publishedAt) return -1;
            return new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime();
          });

          let latestDate = feed.lastEntryDate;
          for (const entry of sorted) {
            // Skip already-saved entries (dedup by guid)
            if (store.hasEntry(feed.id, entry.guid)) continue;

            try {
              await processEntry(entry, feed, store, context);
              if (entry.publishedAt) {
                if (!latestDate || entry.publishedAt > latestDate) {
                  latestDate = entry.publishedAt;
                }
              }
            } catch (err) {
              logger.error({ feedId: feed.id, url: entry.url, err }, 'Failed to process feed entry');
            }
          }

          store.updateLastChecked(feed.id, now, latestDate ?? undefined);
          logger.info({ feedId: feed.id, name: feed.name, processed: sorted.length }, 'Feed poll complete');
        } catch (err) {
          logger.error({ feedId: feed.id, name: feed.name, err }, 'Feed poll failed');
          // Continue with other feeds
        }
      }

      logger.info('RSS feed poll finished');
    },
  };
}

export function ensureDefaultSchedule(context: PluginContext): void {
  const { sqlite, logger } = context;
  const existing = sqlite.getSchedule(RSS_POLL_SCHEDULE_ID);
  if (existing) return;

  const now = new Date().toISOString();
  sqlite.upsertSchedule({
    id: RSS_POLL_SCHEDULE_ID,
    description: 'Polls all subscribed RSS/Atom feeds every 4 hours',
    jobType: RSS_POLL_JOB_TYPE,
    cron: RSS_POLL_DEFAULT_CRON,
    enabled: true,
    config: {},
    created: now,
    updated: now,
  });

  logger.info(
    { scheduleId: RSS_POLL_SCHEDULE_ID, cron: RSS_POLL_DEFAULT_CRON },
    'RSS poll default schedule created',
  );
}
