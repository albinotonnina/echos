import { Type, StringEnum, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import {
  createBackup,
  listBackups,
  pruneBackups,
  formatBytes,
  type BackupConfig,
} from '../../backup/index.js';

export interface ManageBackupsToolDeps {
  backupConfig: BackupConfig;
  retentionCount: number;
}

const schema = Type.Object({
  action: StringEnum(['create', 'list', 'prune'], {
    description:
      '"create" triggers a manual backup now. "list" shows existing backups with size and age. "prune" removes old backups beyond the configured retention count.',
  }),
});

type Params = Static<typeof schema>;

export function createManageBackupsTool(deps: ManageBackupsToolDeps): AgentTool<typeof schema> {
  return {
    name: 'manage_backups',
    label: 'Backups',
    description:
      'Manage EchOS data backups. Create a manual backup, list existing backups, or prune old ones beyond the retention limit.',
    parameters: schema,
    execute: async (_toolCallId: string, params: Params) => {
      switch (params.action) {
        case 'create': {
          const result = await createBackup(deps.backupConfig);
          const text =
            `Backup created successfully.\n` +
            `- File: ${result.fileName}\n` +
            `- Size: ${formatBytes(result.sizeBytes)}\n` +
            `- Notes backed up: ${result.noteCount}\n` +
            `- Timestamp: ${result.timestamp}`;
          return {
            content: [{ type: 'text' as const, text }],
            details: { fileName: result.fileName, sizeBytes: result.sizeBytes, noteCount: result.noteCount },
          };
        }

        case 'list': {
          const infos = listBackups(deps.backupConfig.backupDir);
          if (infos.length === 0) {
            return {
              content: [{ type: 'text' as const, text: 'No backups found.' }],
              details: { count: 0 },
            };
          }
          const lines = infos.map((b, i) => {
            const age = b.ageDays === 0 ? 'today' : b.ageDays === 1 ? '1 day ago' : `${b.ageDays} days ago`;
            return `${i + 1}. ${b.fileName} — ${b.sizeHuman} — ${age}`;
          });
          const text = `Backups (${infos.length}):\n${lines.join('\n')}\n\nRetention: keep ${deps.retentionCount} most recent`;
          return {
            content: [{ type: 'text' as const, text }],
            details: { count: infos.length },
          };
        }

        case 'prune': {
          const removed = pruneBackups(deps.backupConfig.backupDir, deps.retentionCount);
          const text =
            removed === 0
              ? `No backups pruned — already within retention limit of ${deps.retentionCount}.`
              : `Pruned ${removed} old backup${removed === 1 ? '' : 's'} (retention: ${deps.retentionCount} most recent).`;
          return {
            content: [{ type: 'text' as const, text }],
            details: { removed },
          };
        }

        default:
          throw new Error(`Unknown backup action: ${params.action as string}`);
      }
    },
  };
}
