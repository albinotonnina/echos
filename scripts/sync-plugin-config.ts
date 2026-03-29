#!/usr/bin/env tsx

/**
 * Scans packages/ and plugins/ directories, then:
 * 1. Generates tsconfig.paths.json with all workspace path aliases
 * 2. Ensures root package.json has workspace:* deps for every workspace package
 *
 * Exit code 0 if already in sync, 1 if changes were written.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

interface PackageInfo {
  name: string;
  dir: string; // relative dir like "packages/shared" or "plugins/youtube"
  srcIndex: string; // relative path like "./packages/shared/src/index.ts"
}

function discoverWorkspaces(): PackageInfo[] {
  const results: PackageInfo[] = [];

  for (const topDir of ['packages', 'plugins']) {
    const absTop = join(ROOT, topDir);
    if (!existsSync(absTop)) continue;

    for (const entry of readdirSync(absTop, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgJsonPath = join(absTop, entry.name, 'package.json');
      if (!existsSync(pkgJsonPath)) continue;

      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as {
        name?: string;
      };
      if (!pkgJson.name) continue;

      const relDir = `${topDir}/${entry.name}`;
      results.push({
        name: pkgJson.name,
        dir: relDir,
        srcIndex: `./${relDir}/src/index.ts`,
      });
    }
  }

  // Sort alphabetically by name
  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

function buildPaths(
  workspaces: PackageInfo[]
): Record<string, [string] | [string, string]> {
  const paths: Record<string, [string] | [string, string]> = {};

  for (const ws of workspaces) {
    // Main entry: "@echos/shared" -> ["./packages/shared/src/index.ts"]
    paths[ws.name] = [ws.srcIndex];

    // Sub-path alias only for packages (not plugins):
    // "@echos/shared/*" -> ["./packages/shared/src/*"]
    if (ws.dir.startsWith('packages/')) {
      paths[`${ws.name}/*`] = [`./${ws.dir}/src/*`];
    }
  }

  return paths;
}

function buildDeps(workspaces: PackageInfo[]): Record<string, string> {
  const deps: Record<string, string> = {};
  for (const ws of workspaces) {
    deps[ws.name] = 'workspace:*';
  }
  // tsx is also a root dep — preserve it
  deps['tsx'] = '^4.21.0';
  return deps;
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function formatJson(obj: unknown): string {
  return JSON.stringify(obj, null, 2) + '\n';
}

let changed = false;
const summary: string[] = [];

// --- Discover workspaces ---
const workspaces = discoverWorkspaces();

// --- 1. Generate tsconfig.paths.json ---
const pathsFile = join(ROOT, 'tsconfig.paths.json');
const newPaths = {
  compilerOptions: {
    paths: buildPaths(workspaces),
  },
};
const newPathsStr = formatJson(newPaths);

const existingPathsStr = existsSync(pathsFile)
  ? readFileSync(pathsFile, 'utf-8')
  : '';

if (newPathsStr !== existingPathsStr) {
  writeFileSync(pathsFile, newPathsStr);
  changed = true;
  summary.push(
    existingPathsStr
      ? 'Updated tsconfig.paths.json'
      : 'Created tsconfig.paths.json'
  );
} else {
  summary.push('tsconfig.paths.json is up to date');
}

// --- 2. Update root package.json dependencies ---
const rootPkgPath = join(ROOT, 'package.json');
const rootPkg = readJson(rootPkgPath) as {
  dependencies?: Record<string, string>;
  [key: string]: unknown;
};

const newDeps = buildDeps(workspaces);
const oldDeps = rootPkg.dependencies ?? {};

// Check if deps changed
const oldDepsStr = JSON.stringify(oldDeps, Object.keys(oldDeps).sort());
const newDepsStr = JSON.stringify(newDeps, Object.keys(newDeps).sort());

if (oldDepsStr !== newDepsStr) {
  // Find what was added/removed
  const added = Object.keys(newDeps).filter((k) => !(k in oldDeps));
  const removed = Object.keys(oldDeps).filter((k) => !(k in newDeps));

  rootPkg.dependencies = newDeps;
  writeFileSync(rootPkgPath, formatJson(rootPkg));
  changed = true;

  if (added.length > 0) summary.push(`Added deps: ${added.join(', ')}`);
  if (removed.length > 0) summary.push(`Removed deps: ${removed.join(', ')}`);
  if (added.length === 0 && removed.length === 0)
    summary.push('Reordered package.json dependencies');
} else {
  summary.push('package.json dependencies are up to date');
}

// --- Summary ---
console.log('sync-plugin-config:');
for (const line of summary) {
  console.log(`  ${line}`);
}

if (changed) {
  console.log('\nChanges written.');
  process.exit(1);
} else {
  console.log('\nEverything in sync.');
  process.exit(0);
}
