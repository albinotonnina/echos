import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from './logging/index.js';

const logger = createLogger('version');

/**
 * Walks up the directory tree from this file to find the root package.json
 * (identified by `"name": "echos"`) and returns its version.
 *
 * The result is memoised after the first successful resolution so that
 * repeated calls never hit the filesystem again.
 *
 * Works in both `tsx` (source) and compiled (`dist`) contexts.
 */
let cachedVersion: string | undefined;

export function getVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;

  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    // Walk up a maximum of 6 levels to avoid an infinite loop in edge cases
    for (let i = 0; i < 6; i++) {
      const candidate = join(dir, 'package.json');
      try {
        const raw = readFileSync(candidate, 'utf8');
        const pkg = JSON.parse(raw) as { name?: string; version?: string };
        if (pkg.name === 'echos' && pkg.version) {
          cachedVersion = pkg.version;
          return cachedVersion;
        }
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') {
          // file doesn't exist at this level — keep walking up
        } else {
          // Unexpected I/O or JSON parsing error — surface to outer handler
          throw error;
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break; // reached filesystem root
      dir = parent;
    }
  } catch (error) {
    logger.error({ err: error }, 'Unexpected error resolving application version from package.json');
  }

  return 'unknown';
}
