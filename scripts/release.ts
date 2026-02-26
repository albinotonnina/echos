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
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

// Discover all workspace packages dynamically to avoid missing newly-added ones
function discoverWorkspacePackages(dir: string): string[] {
  try {
    return readdirSync(resolve(ROOT, dir))
      .filter((entry) => statSync(resolve(ROOT, dir, entry)).isDirectory())
      .map((entry) => resolve(ROOT, dir, entry, 'package.json'));
  } catch (err) {
    const error = err as NodeJS.ErrnoException;

    // If the directory doesn't exist, treat it as having no workspace packages.
    if (error && error.code === 'ENOENT') {
      return [];
    }

    // For all other errors, surface the problem instead of silently skipping packages.
    console.warn(
      `Warning: failed to discover workspace packages in "${dir}": ${
        error && error.message ? error.message : String(error)
      }`,
    );
    throw err;
  }
}

// Collect all package.json files to update
const packageJsonPaths: string[] = [
  rootPkgPath,
  ...discoverWorkspacePackages('packages'),
  ...discoverWorkspacePackages('plugins'),
];

for (const pkgPath of packageJsonPaths) {
  try {
    updatePackageJson(pkgPath, nextVersion);
  } catch {
    // File may not exist (optional plugins); skip silently
  }
}

// Git operations have been removed in favor of GitHub Actions PR flow.
console.log(`\n✅ Versions updated to v${nextVersion} across packages.`);
