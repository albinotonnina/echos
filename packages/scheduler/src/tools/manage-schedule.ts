import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ScheduleManager } from '../scheduler.js';
import type { SqliteStorage } from '@echos/core';
import type { ScheduleEntry } from '@echos/shared';
import { randomUUID } from 'node:crypto';

export interface ManageScheduleToolDeps {
  sqlite: SqliteStorage;
  scheduleManager?: ScheduleManager;
}

const InputSchema = Type.Object({
  action: Type.Union([Type.Literal('upsert'), Type.Literal('delete'), Type.Literal('list')]),
  id: Type.Optional(Type.String({ description: 'Schedule ID to update or delete' })),
  jobType: Type.Optional(Type.String({ description: 'The job type (e.g. digest, newsletter)' })),
  cron: Type.Optional(Type.String({ description: 'Cron expression (e.g. 0 8 * * *)' })),
  description: Type.Optional(Type.String({ description: 'Human readable description' })),
  enabled: Type.Optional(
    Type.Boolean({ description: 'Whether the schedule is active', default: true }),
  ),
  config: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), { description: 'JSON config for the job' }),
  ),
});

export function createManageScheduleTool(deps: ManageScheduleToolDeps) {
  return {
    name: 'manage_schedule',
    label: 'Manage Schedules',
    description: 'Create, update, enable/disable, or delete scheduled background jobs.',
    parameters: InputSchema,
    setScheduleManager(sm: ScheduleManager) {
      deps.scheduleManager = sm;
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const action = params['action'] as string;
      const id = params['id'] as string | undefined;
      const jobType = params['jobType'] as string | undefined;
      const cron = params['cron'] as string | undefined;
      const description = params['description'] as string | undefined;
      const enabled = params['enabled'] as boolean | undefined;
      const config = params['config'] as Record<string, unknown> | undefined;

      const formatResponse = (text: string) => ({
        content: [{ type: 'text' as const, text }],
        details: {},
      });

      if (action === 'list') {
        const schedules = deps.sqlite.listSchedules();
        if (schedules.length === 0) {
          return formatResponse('No schedules found.');
        }
        return formatResponse(
          schedules
            .map(
              (s) =>
                `- [${s.id}] ${s.jobType} | cron: ${s.cron} | enabled: ${s.enabled} | desc: ${s.description} | config: ${JSON.stringify(s.config)}`,
            )
            .join('\n'),
        );
      }

      if (action === 'delete') {
        if (!id) return formatResponse('Error: id is required for delete.');
        if (deps.scheduleManager) {
          const deleted = await deps.scheduleManager.deleteSchedule(id);
          if (deleted) return formatResponse(`Schedule ${id} deleted successfully.`);
        } else {
          const deleted = deps.sqlite.deleteSchedule(id);
          if (deleted) return formatResponse(`Schedule ${id} deleted successfully (offline).`);
        }
        return formatResponse(`Error: Schedule ${id} not found.`);
      }

      if (action === 'upsert') {
        if (!jobType || !cron)
          return formatResponse('Error: jobType and cron are required for upsert.');

        let existingId = id;
        if (!existingId) {
          existingId = randomUUID();
        }

        const now = new Date().toISOString();
        const existing = deps.sqlite.getSchedule(existingId);

        const entry: ScheduleEntry = {
          id: existingId,
          jobType,
          cron,
          enabled: enabled ?? (existing ? existing.enabled : true),
          description: description ?? (existing ? existing.description : ''),
          config: (config as Record<string, unknown>) ?? (existing ? existing.config : {}),
          created: existing ? existing.created : now,
          updated: now,
        };

        if (deps.scheduleManager) {
          await deps.scheduleManager.upsertSchedule(entry);
        } else {
          deps.sqlite.upsertSchedule(entry);
        }
        return formatResponse(`Schedule ${existingId} upserted successfully.`);
      }

      return formatResponse('Unknown action.');
    },
  };
}
