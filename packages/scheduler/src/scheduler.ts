import type { Queue } from 'bullmq';
import type { Logger } from 'pino';

export interface ScheduleConfig {
  digestSchedule: string;
  newsletterSchedule: string;
  trendingSchedule: string;
  reminderCheckSchedule: string;
}

export async function registerScheduledJobs(
  queue: Queue,
  config: ScheduleConfig,
  logger: Logger,
): Promise<void> {
  if (config.digestSchedule) {
    await queue.upsertJobScheduler(
      'daily-digest',
      { pattern: config.digestSchedule },
      { name: 'digest', data: { type: 'digest' } },
    );
    logger.info({ schedule: config.digestSchedule }, 'Digest job scheduled');
  }

  if (config.newsletterSchedule) {
    await queue.upsertJobScheduler(
      'newsletter-scrape',
      { pattern: config.newsletterSchedule },
      { name: 'newsletter', data: { type: 'newsletter' } },
    );
    logger.info({ schedule: config.newsletterSchedule }, 'Newsletter job scheduled');
  }

  if (config.trendingSchedule) {
    await queue.upsertJobScheduler(
      'trending-monitor',
      { pattern: config.trendingSchedule },
      { name: 'trending', data: { type: 'trending' } },
    );
    logger.info({ schedule: config.trendingSchedule }, 'Trending job scheduled');
  }

  if (config.reminderCheckSchedule) {
    await queue.upsertJobScheduler(
      'reminder-check',
      { pattern: config.reminderCheckSchedule },
      { name: 'reminder_check', data: { type: 'reminder_check' } },
    );
    logger.info({ schedule: config.reminderCheckSchedule }, 'Reminder check job scheduled');
  }
}
