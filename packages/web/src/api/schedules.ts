import type { FastifyInstance } from 'fastify';
import type { AgentDeps } from '@echos/core';
import type { Logger } from 'pino';
import type { ScheduleEntry } from '@echos/shared';
import { RESERVED_SCHEDULE_IDS } from '@echos/shared';
import { randomUUID } from 'node:crypto';

export function isValidCronField(field: string, min: number, max: number): boolean {
  if (field.includes(',')) {
    return field.split(',').every((f) => isValidCronField(f, min, max));
  }
  if (field.includes('/')) {
    const [range, step] = field.split('/');
    if (!step || !/^\d+$/.test(step) || parseInt(step, 10) < 1) return false;
    return range === '*' || isValidCronField(range, min, max);
  }
  if (field.includes('-')) {
    const parts = field.split('-');
    if (parts.length !== 2) return false;
    const [start, end] = parts;
    if (!/^\d+$/.test(start) || !/^\d+$/.test(end)) return false;
    const s = parseInt(start, 10);
    const e = parseInt(end, 10);
    return s >= min && e <= max && s <= e;
  }
  if (field === '*') return true;
  if (/^\d+$/.test(field)) {
    const n = parseInt(field, 10);
    return n >= min && n <= max;
  }
  return false;
}

// Validates a standard 5-field cron expression: minute hour day-of-month month day-of-week
// Does not support 6-field (with seconds) expressions.
// Day-of-week accepts 0-7 where both 0 and 7 represent Sunday.
export function isValidCron(cron: string): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return (
    isValidCronField(minute, 0, 59) &&
    isValidCronField(hour, 0, 23) &&
    isValidCronField(dayOfMonth, 1, 31) &&
    isValidCronField(month, 1, 12) &&
    isValidCronField(dayOfWeek, 0, 7)
  );
}

export function registerScheduleRoutes(
  app: FastifyInstance,
  agentDeps: AgentDeps,
  logger: Logger,
  syncSchedule?: (id: string) => Promise<void>,
  deleteSchedule?: (id: string) => Promise<boolean>,
) {
  app.get('/api/schedules', async (_request, reply) => {
    try {
      const schedules = agentDeps.sqlite.listSchedules();
      return reply.send({ schedules });
    } catch (err) {
      logger.error({ err }, 'Failed to list schedules');
      return reply.status(500).send({ error: 'Failed to list schedules' });
    }
  });

  app.get('/api/schedules/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const schedule = agentDeps.sqlite.getSchedule(id);
      if (!schedule) {
        return reply.status(404).send({ error: 'Schedule not found' });
      }
      return reply.send({ schedule });
    } catch (err) {
      logger.error({ err, id }, 'Failed to get schedule');
      return reply.status(500).send({ error: 'Failed to get schedule' });
    }
  });

  app.post<{
      Body: {
          id?: string;
          jobType: string;
          cron: string;
          enabled?: boolean;
          description?: string;
          config?: Record<string, unknown>;
      };
  }>(
      '/api/schedules',
      {
          schema: {
              body: {
                  type: 'object',
                  required: ['jobType', 'cron'],
                  properties: {
                      id: { type: 'string', minLength: 1 },
                      jobType: { type: 'string', minLength: 1 },
                      cron: { type: 'string', minLength: 1 },
                      enabled: { type: 'boolean' },
                      description: { type: 'string' },
                      config: { type: 'object' },
                  },
                  additionalProperties: false,
              },
          },
      },
      async (request, reply) => {
      const body = request.body;
      try {
          let existingId = body.id;
          if (!existingId) existingId = randomUUID();

      if (RESERVED_SCHEDULE_IDS.has(existingId)) {
        return reply.status(400).send({ error: `Schedule ID "${existingId}" is reserved for system use` });
      }

      if (!isValidCron(body.cron)) {
        return reply.status(400).send({ error: `Invalid cron expression: "${body.cron}". Expected 5-field format: minute hour day-of-month month day-of-week (e.g. "0 8 * * *")` });
      }

      const now = new Date().toISOString();
      const existing = agentDeps.sqlite.getSchedule(existingId);

      const entry: ScheduleEntry = {
        id: existingId,
        jobType: body.jobType,
        cron: body.cron,
        enabled: body.enabled ?? (existing ? existing.enabled : true),
        description: body.description ?? (existing ? existing.description : ''),
        config: body.config ?? (existing ? existing.config : {}),
        created: existing ? existing.created : now,
        updated: now,
      };

      agentDeps.sqlite.upsertSchedule(entry);
      if (syncSchedule) {
          try {
              await syncSchedule(entry.id);
          } catch (syncErr) {
              // Roll back the DB change to keep SQLite and BullMQ in sync
              if (existing) {
                  agentDeps.sqlite.upsertSchedule(existing);
              } else {
                  agentDeps.sqlite.deleteSchedule(entry.id);
              }
              throw syncErr;
          }
      }

      return reply.send({ schedule: entry });
    } catch (err) {
      logger.error({ err }, 'Failed to upsert schedule');
      return reply.status(500).send({ error: 'Failed to upsert schedule' });
    }
  });

  app.delete('/api/schedules/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      if (RESERVED_SCHEDULE_IDS.has(id)) {
        return reply.status(400).send({ error: `Schedule ID "${id}" is reserved for system use and cannot be deleted` });
      }
      let deleted = false;
      if (deleteSchedule) {
        deleted = await deleteSchedule(id);
      } else {
        deleted = agentDeps.sqlite.deleteSchedule(id);
      }

      if (!deleted) {
        return reply.status(404).send({ error: 'Schedule not found' });
      }
      return reply.send({ success: true });
    } catch (err) {
      logger.error({ err, id }, 'Failed to delete schedule');
      return reply.status(500).send({ error: 'Failed to delete schedule' });
    }
  });
}
