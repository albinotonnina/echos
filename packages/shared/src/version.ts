import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Walks up the directory tree from this file to find the root package.json
 * (identified by `"name": "echos"`) and returns its version.
 *
 * Works in both `tsx` (source) and compiled (`dist`) contexts.
 */
export function getVersion(): string {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    // Walk up a maximum of 6 levels to avoid an infinite loop in edge cases
    for (let i = 0; i < 6; i++) {
      const candidate = join(dir, 'package.json');
      try {
        const raw = readFileSync(candidate, 'utf8');
        const pkg = JSON.parse(raw) as { name?: string; version?: string };
        if (pkg.name === 'echos' && pkg.version) {
          return pkg.version;
        }
      } catch {
        // file doesn't exist at this level, keep walking up
      }
      const parent = dirname(dir);
      if (parent === dir) break; // reached filesystem root
      dir = parent;
    }
  } catch {
    // ignore – fall through to default
  }
  return 'unknown';
}
