import { execFile } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';

const execFileAsync = promisify(execFile);

export interface BackupConfig {
  /** Knowledge markdown directory */
  knowledgeDir: string;
  /** SQLite database path (path to the .db file, e.g. /data/db/echos.db) */
  dbFilePath: string;
  /** LanceDB vectors directory */
  vectorsDir: string;
  /** Where to write backup archives */
  backupDir: string;
}

export interface BackupResult {
  backupPath: string;
  fileName: string;
  sizeBytes: number;
  noteCount: number;
  timestamp: string;
}

export interface BackupInfo {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  sizeHuman: string;
  timestamp: string;
  ageDays: number;
}

/** Format bytes as a human-readable string (B / KB / MB / GB). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Count non-deleted notes in the SQLite database using a read-only connection. */
function countNotes(dbFilePath: string): number {
  if (!existsSync(dbFilePath)) return 0;
  const db = new Database(dbFilePath, { readonly: true });
  try {
    const row = db
      .prepare("SELECT COUNT(*) as n FROM notes WHERE (status IS NULL OR status != 'deleted')")
      .get() as { n: number } | undefined;
    return row?.n ?? 0;
  } catch {
    return 0;
  } finally {
    db.close();
  }
}

/**
 * Create a timestamped `.tar.gz` backup archive.
 *
 * The archive contains:
 *   - `knowledge/`            — all markdown files
 *   - `db/echos.db`           — SQLite database (consistent snapshot via `.backup()`)
 *   - `db/vectors/`           — LanceDB data directory
 *   - `backup-manifest.json`  — version, timestamp, note count
 */
export async function createBackup(config: BackupConfig): Promise<BackupResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const fileName = `echos-backup-${timestamp}.tar.gz`;

  await mkdir(config.backupDir, { recursive: true });

  const backupPath = join(config.backupDir, fileName);
  const noteCount = countNotes(config.dbFilePath);

  // Staging directory: assembles all content before archiving
  const stagingDir = join(config.backupDir, `.tmp-backup-${timestamp}`);
  await mkdir(stagingDir, { recursive: true });

  try {
    // 1. SQLite — use .backup() API for a crash-consistent snapshot
    const dbDir = join(stagingDir, 'db');
    await mkdir(dbDir, { recursive: true });
    if (existsSync(config.dbFilePath)) {
      const srcDb = new Database(config.dbFilePath, { readonly: true });
      try {
        await srcDb.backup(join(dbDir, 'echos.db'));
      } finally {
        srcDb.close();
      }
    }

    // 2. Vectors directory — copy LanceDB data
    if (existsSync(config.vectorsDir)) {
      await cp(config.vectorsDir, join(stagingDir, 'db', 'vectors'), { recursive: true });
    }

    // 3. Knowledge directory — copy all markdown files
    if (existsSync(config.knowledgeDir)) {
      await cp(config.knowledgeDir, join(stagingDir, 'knowledge'), { recursive: true });
    }

    // 4. Write manifest
    const manifest = {
      version: '1',
      timestamp: new Date().toISOString(),
      noteCount,
    };
    await writeFile(
      join(stagingDir, 'backup-manifest.json'),
      JSON.stringify(manifest, null, 2),
    );

    // 5. Create the compressed archive from the staging directory
    await execFileAsync('tar', ['-czf', backupPath, '-C', stagingDir, '.']);

    const sizeBytes = statSync(backupPath).size;

    return {
      backupPath,
      fileName,
      sizeBytes,
      noteCount,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    // Remove the partial archive so it is not mistaken for a valid backup
    try {
      await rm(backupPath, { force: true });
    } catch {
      // ignore cleanup errors
    }
    throw err;
  } finally {
    // Always clean up the staging directory
    try {
      await rm(stagingDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * List existing backups in the backup directory, sorted newest-first.
 */
export function listBackups(backupDir: string): BackupInfo[] {
  if (!existsSync(backupDir)) return [];

  const now = Date.now();
  const infos: BackupInfo[] = [];

  let entries: string[];
  try {
    entries = readdirSync(backupDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.startsWith('echos-backup-') || !entry.endsWith('.tar.gz')) continue;
    const filePath = join(backupDir, entry);
    try {
      const stat = statSync(filePath);
      if (!stat.isFile()) continue;
      const ageDays = Math.floor((now - stat.mtimeMs) / (1000 * 60 * 60 * 24));
      infos.push({
        fileName: entry,
        filePath,
        sizeBytes: stat.size,
        sizeHuman: formatBytes(stat.size),
        timestamp: stat.mtime.toISOString(),
        ageDays,
      });
    } catch {
      // skip unreadable entries
    }
  }

  // Sort newest first
  infos.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return infos;
}

/**
 * Restore a backup archive to a target directory.
 * Does NOT overwrite live data — the caller is responsible for swapping directories.
 *
 * Validates all archive entry paths before extracting to prevent path-traversal attacks.
 */
export async function restoreBackup(backupPath: string, targetDir: string): Promise<void> {
  // List entries first and reject any that escape targetDir
  const { stdout } = await execFileAsync('tar', ['-tzf', backupPath]);
  const absTarget = join(targetDir, '.'); // normalize
  for (const entry of stdout.split('\n').filter(Boolean)) {
    // Reject absolute paths and any path containing '..' segments
    if (entry.startsWith('/') || entry.split('/').includes('..')) {
      throw new Error(`Unsafe archive entry rejected: ${entry}`);
    }
    const resolved = join(absTarget, entry);
    if (!resolved.startsWith(absTarget)) {
      throw new Error(`Unsafe archive entry rejected: ${entry}`);
    }
  }
  await mkdir(targetDir, { recursive: true });
  await execFileAsync('tar', ['-xzf', backupPath, '-C', targetDir]);
}

/**
 * Remove oldest backups beyond keepCount.
 * Returns the number of backups removed.
 */
export function pruneBackups(backupDir: string, keepCount: number): number {
  const infos = listBackups(backupDir); // sorted newest-first; oldest are at the end
  if (infos.length <= keepCount) return 0;

  const toDelete = infos.slice(keepCount);
  let removed = 0;
  for (const info of toDelete) {
    try {
      unlinkSync(info.filePath);
      removed++;
    } catch {
      // ignore individual deletion failures
    }
  }
  return removed;
}
