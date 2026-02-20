#!/usr/bin/env tsx
/**
 * Release script — bumps all workspace package versions, commits, and tags.
 *
 * Usage:
 *   pnpm release --patch    # 0.1.0 → 0.1.1
 *   pnpm release --minor    # 0.1.0 → 0.2.0
 *   pnpm release --major    # 0.1.0 → 1.0.0
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function bumpVersion(current: string, bump: 'major' | 'minor' | 'patch'): string {
  const parts = current.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Cannot parse version: ${current}`);
  }
  const [major, minor, patch] = parts as [number, number, number];
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function updatePackageJson(filePath: string, newVersion: string): void {
  const raw = readFileSync(filePath, 'utf8');
  const pkg = JSON.parse(raw) as { version?: string };
  if (pkg.version === undefined) return; // skip packages without a version field
  pkg.version = newVersion;
  // Preserve trailing newline if present
  const trailing = raw.endsWith('\n') ? '\n' : '';
  writeFileSync(filePath, JSON.stringify(pkg, null, 2) + trailing, 'utf8');
  console.log(`  Updated ${filePath.replace(ROOT + '/', '')}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const ROOT = resolve(import.meta.dirname, '..');

const args = process.argv.slice(2);
const bump = args.find((a) => ['--major', '--minor', '--patch'].includes(a))?.slice(2) as
  | 'major'
  | 'minor'
  | 'patch'
  | undefined;

if (!bump) {
  console.error('Usage: pnpm release --patch | --minor | --major');
  process.exit(1);
}

// Read current root version
const rootPkgPath = resolve(ROOT, 'package.json');
const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8')) as { version: string };
const currentVersion = rootPkg.version;
const nextVersion = bumpVersion(currentVersion, bump);

console.log(`\nBumping ${bump}: ${currentVersion} → ${nextVersion}\n`);

// Collect all package.json files to update
const packageJsonPaths: string[] = [
  rootPkgPath,
  ...['packages/cli', 'packages/core', 'packages/scheduler', 'packages/shared', 'packages/web', 'packages/telegram'].map(
    (p) => resolve(ROOT, p, 'package.json'),
  ),
  ...['plugins/article', 'plugins/content-creation', 'plugins/youtube'].map(
    (p) => resolve(ROOT, p, 'package.json'),
  ),
];

for (const pkgPath of packageJsonPaths) {
  try {
    updatePackageJson(pkgPath, nextVersion);
  } catch {
    // File may not exist (optional plugins); skip silently
  }
}

// Commit version bumps
const relativePackagePaths = packageJsonPaths
  .map((p) => p.replace(ROOT + '/', ''))
  .join(' ');
run(`git add ${relativePackagePaths}`);
run(`git commit -m "chore: release v${nextVersion}"`);
console.log(`Committed version bumps.`);

run(`git push`);
console.log(`Pushed commit.`);

// Tag and push
const tag = `v${nextVersion}`;
run(`git tag ${tag}`);
console.log(`Tagged: ${tag}`);

run(`git push origin ${tag}`);
console.log(`Pushed: ${tag}\n`);
