import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createManageBackupsTool } from './backup.js';
import type { BackupConfig } from '../../backup/index.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function firstText(content: Array<{ type: string; text?: string }>): string {
  const item = content.find((c) => c.type === 'text');
  if (!item?.text) throw new Error('No text content in result');
  return item.text;
}

/** Create a minimal but valid .tar.gz backup file in backupDir. */
function plantBackup(backupDir: string, name: string): string {
  const archivePath = join(backupDir, name);
  const stagingDir = join(backupDir, `.stage-${Date.now()}`);
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(stagingDir, 'backup-manifest.json'), '{"version":"1"}');
  execFileSync('tar', ['-czf', archivePath, '-C', stagingDir, '.']);
  rmSync(stagingDir, { recursive: true, force: true });
  return archivePath;
}

// ─── fixtures ────────────────────────────────────────────────────────────────

let root: string;
let backupDir: string;
let knowledgeDir: string;
let config: BackupConfig;

beforeEach(() => {
  root = join(tmpdir(), `echos-backup-tool-test-${Date.now()}`);
  backupDir = join(root, 'backups');
  knowledgeDir = join(root, 'knowledge');
  mkdirSync(backupDir, { recursive: true });
  mkdirSync(knowledgeDir, { recursive: true });
  config = {
    knowledgeDir,
    dbFilePath: join(root, 'echos.db'),
    vectorsDir: join(root, 'vectors'),
    backupDir,
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// ─── tests ───────────────────────────────────────────────────────────────────

describe('manage_backups tool — create', () => {
  it('creates a backup archive and returns success text', async () => {
    const tool = createManageBackupsTool({ backupConfig: config, retentionCount: 7 });
    const result = await tool.execute('call-1', { action: 'create' });
    const text = firstText(result.content as Array<{ type: string; text?: string }>);

    expect(text).toContain('Backup created successfully');
    expect(text).toMatch(/echos-backup-.*\.tar\.gz/);

    const details = result.details as { fileName: string; sizeBytes: number; noteCount: number };
    expect(details.fileName).toMatch(/^echos-backup-.*\.tar\.gz$/);
    expect(details.sizeBytes).toBeGreaterThan(0);
    expect(details.noteCount).toBe(0); // no DB file → 0 notes
  });

  it('archive file exists on disk after create', async () => {
    const tool = createManageBackupsTool({ backupConfig: config, retentionCount: 7 });
    await tool.execute('call-2', { action: 'create' });

    const files = (await import('node:fs')).readdirSync(backupDir).filter((f) =>
      f.startsWith('echos-backup-') && f.endsWith('.tar.gz'),
    );
    expect(files).toHaveLength(1);
  });
});

describe('manage_backups tool — list', () => {
  it('returns "No backups found" when the directory is empty', async () => {
    const tool = createManageBackupsTool({ backupConfig: config, retentionCount: 7 });
    const result = await tool.execute('call-3', { action: 'list' });
    const text = firstText(result.content as Array<{ type: string; text?: string }>);

    expect(text).toBe('No backups found.');
    const details = result.details as { count: number };
    expect(details.count).toBe(0);
  });

  it('lists existing backup archives', async () => {
    plantBackup(backupDir, 'echos-backup-2026-01-01_00-00-00.tar.gz');
    plantBackup(backupDir, 'echos-backup-2026-01-02_00-00-00.tar.gz');

    const tool = createManageBackupsTool({ backupConfig: config, retentionCount: 7 });
    const result = await tool.execute('call-4', { action: 'list' });
    const text = firstText(result.content as Array<{ type: string; text?: string }>);

    expect(text).toContain('Backups (2)');
    expect(text).toContain('echos-backup-2026-01-');
    expect(text).toContain('keep 7 most recent');

    const details = result.details as { count: number };
    expect(details.count).toBe(2);
  });

  it('ignores files that do not match the backup naming pattern', async () => {
    writeFileSync(join(backupDir, 'not-a-backup.tar.gz'), 'x');
    writeFileSync(join(backupDir, 'random.txt'), 'x');
    plantBackup(backupDir, 'echos-backup-2026-03-01_02-00-00.tar.gz');

    const tool = createManageBackupsTool({ backupConfig: config, retentionCount: 7 });
    const result = await tool.execute('call-5', { action: 'list' });
    const details = result.details as { count: number };
    expect(details.count).toBe(1);
  });
});

describe('manage_backups tool — prune', () => {
  it('reports nothing pruned when within retention limit', async () => {
    plantBackup(backupDir, 'echos-backup-2026-01-01_00-00-00.tar.gz');

    const tool = createManageBackupsTool({ backupConfig: config, retentionCount: 7 });
    const result = await tool.execute('call-6', { action: 'prune' });
    const text = firstText(result.content as Array<{ type: string; text?: string }>);

    expect(text).toContain('No backups pruned');
    const details = result.details as { removed: number };
    expect(details.removed).toBe(0);
  });

  it('removes oldest backups beyond the retention count', async () => {
    // Plant 4 archives; with retentionCount=2 the 2 oldest should be deleted
    for (let d = 1; d <= 4; d++) {
      plantBackup(backupDir, `echos-backup-2026-01-0${d}_00-00-00.tar.gz`);
    }

    const tool = createManageBackupsTool({ backupConfig: config, retentionCount: 2 });
    const result = await tool.execute('call-7', { action: 'prune' });
    const text = firstText(result.content as Array<{ type: string; text?: string }>);

    expect(text).toContain('Pruned 2 old backups');
    const details = result.details as { removed: number };
    expect(details.removed).toBe(2);

    // Only the 2 most recent remain
    const remaining = (await import('node:fs'))
      .readdirSync(backupDir)
      .filter((f) => f.startsWith('echos-backup-'));
    expect(remaining).toHaveLength(2);

    // The 2 oldest are gone
    expect(existsSync(join(backupDir, 'echos-backup-2026-01-01_00-00-00.tar.gz'))).toBe(false);
    expect(existsSync(join(backupDir, 'echos-backup-2026-01-02_00-00-00.tar.gz'))).toBe(false);
  });

  it('uses singular "backup" in message when exactly one is removed', async () => {
    plantBackup(backupDir, 'echos-backup-2026-01-01_00-00-00.tar.gz');
    plantBackup(backupDir, 'echos-backup-2026-01-02_00-00-00.tar.gz');

    const tool = createManageBackupsTool({ backupConfig: config, retentionCount: 1 });
    const result = await tool.execute('call-8', { action: 'prune' });
    const text = firstText(result.content as Array<{ type: string; text?: string }>);

    expect(text).toContain('Pruned 1 old backup ');
    expect(text).not.toContain('backups');
  });
});
