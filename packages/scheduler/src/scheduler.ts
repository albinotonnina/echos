import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import type { SqliteStorage, ScheduledJob } from '@echos/core';
import { RESERVED_SCHEDULE_IDS } from '@echos/shared';

export class ScheduleManager {
  constructor(
    private readonly queue: Queue,
    private readonly sqlite: SqliteStorage,
    private readonly jobs: Map<string, ScheduledJob>,
    private readonly logger: Logger,
  ) { }

  /**
   * Syncs all enabled schedules from the DB with BullMQ.
   * Removes any BullMQ schedulers that are no longer in the DB or disabled.
   */
  async syncAll(): Promise<void> {
    const dbSchedules = this.sqlite.listSchedules(true);
    const existingSchedulers = await this.queue.getJobSchedulers();
    const existingIds = existingSchedulers.map((s) => s.id).filter((id): id is string => id !== undefined);
    const updatedIds = new Set<string>();

    for (const schedule of dbSchedules) {
      await this.syncScheduleFromEntity(schedule);
      updatedIds.add(schedule.id);
    }

    // Always schedule the hardcoded internal reminder check (runs every minute)
    await this.queue.upsertJobScheduler(
      'reminder-check',
      { pattern: '* * * * *' },
      { name: 'reminder_check', data: { type: 'reminder_check' } },
    );
    updatedIds.add('reminder-check');

    // Always schedule export cleanup (runs every hour)
    await this.queue.upsertJobScheduler(
      'export-cleanup',
      { pattern: '0 * * * *' },
      { name: 'export_cleanup', data: { type: 'export_cleanup' } },
    );
    updatedIds.add('export-cleanup');

    // Remove schedulers that are no longer enabled/in DB (except hardcoded reminder check)
    for (const id of existingIds) {
      if (!updatedIds.has(id)) {
        await this.removeSchedule(id);
      }
    }

    this.logger.info({ count: dbSchedules.length }, 'Schedules synced with DB');
  }

  /**
   * Syncs a specific schedule ID from the DB to BullMQ.
   */
  async syncSchedule(id: string): Promise<void> {
    const schedule = this.sqlite.getSchedule(id);
    if (!schedule || !schedule.enabled) {
      await this.removeSchedule(id);
      return;
    }
    await this.syncScheduleFromEntity(schedule);
  }

  /**
   * Internal helper to upsert from a ScheduleEntry to BullMQ.
   */
  private async syncScheduleFromEntity(schedule: import('@echos/shared').ScheduleEntry): Promise<void> {
    if (!this.jobs.has(schedule.jobType)) {
      this.logger.warn(
        { id: schedule.id, jobType: schedule.jobType },
        'Skipping schedule for unknown job type (no plugin registered)',
      );
      // Disable the schedule in SQLite to avoid repeated warnings on future syncs
      this.sqlite.upsertSchedule({ ...schedule, enabled: false });
      await this.removeSchedule(schedule.id);
      return;
    }

    await this.queue.upsertJobScheduler(
      schedule.id,
      { pattern: schedule.cron },
      { name: schedule.jobType, data: { type: schedule.jobType, config: schedule.config } },
    );
    this.logger.info({ id: schedule.id, cron: schedule.cron, type: schedule.jobType }, 'Schedule synced');
  }

  /**
   * Upserts a schedule in DB and syncs to BullMQ.
   */
  async upsertSchedule(schedule: import('@echos/shared').ScheduleEntry): Promise<void> {
    const existing = this.sqlite.getSchedule(schedule.id);
    this.sqlite.upsertSchedule(schedule);
    try {
      await this.syncSchedule(schedule.id);
    } catch (err) {
      // Roll back the DB change to keep SQLite and BullMQ in sync
      if (existing) {
        this.sqlite.upsertSchedule(existing);
      } else {
        this.sqlite.deleteSchedule(schedule.id);
      }
      throw err;
    }
  }

  /**
   * Deletes a schedule from DB and BullMQ.
   */
  async deleteSchedule(id: string): Promise<boolean> {
    const deleted = this.sqlite.deleteSchedule(id);
    if (deleted) {
      await this.removeSchedule(id);
    }
    return deleted;
  }

  /**
   * Removes a schedule from BullMQ.
   */
  async removeSchedule(id: string): Promise<void> {
    try {
      await this.queue.removeJobScheduler(id);
      this.logger.info({ id }, 'Schedule removed from queue');
    } catch (err) {
      this.logger.error({ err, id }, 'Failed to remove schedule from queue');
    }
  }

  /**
   * Returns the processor function for a given job type.
   */
  getProcessor(type: string): ScheduledJob['processor'] | undefined {
    return this.jobs.get(type)?.processor;
  }
}
