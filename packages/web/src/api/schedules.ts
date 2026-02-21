import type { FastifyInstance } from 'fastify';
import type { AgentDeps } from '@echos/core';
import type { Logger } from 'pino';
import type { ScheduleEntry } from '@echos/shared';
import { randomUUID } from 'node:crypto';

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
                await syncSchedule(entry.id);
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
