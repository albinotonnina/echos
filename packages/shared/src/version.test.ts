import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the actual root package.json version directly so the test stays in
 * sync with the repo. Starts from process.cwd() which Vitest sets to the
 * repo root.
 */
function readRootVersion(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    try {
      const raw = readFileSync(join(dir, 'package.json'), 'utf8');
      const pkg = JSON.parse(raw) as { name?: string; version?: string };
      if (pkg.name === 'echos' && pkg.version) return pkg.version;
    } catch {
      // keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not find root package.json (started from ${process.cwd()})`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getVersion', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('returns the version from the root package.json', async () => {
    const { getVersion } = await import('./version.js');
    const expected = readRootVersion();
    expect(getVersion()).toBe(expected);
  });

  it('memoises the result — calling it multiple times returns the same value without re-reading the filesystem', async () => {
    // Track readFileSync calls via a counting mock
    let callCount = 0;

    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        readFileSync: (path: unknown, ...args: unknown[]) => {
          callCount++;
          return (actual.readFileSync as (...a: unknown[]) => unknown)(path, ...args);
        },
      };
    });

    const { getVersion } = await import('./version.js');

    const first = getVersion();
    const callsAfterFirst = callCount;

    // Subsequent calls must not trigger any new readFileSync calls
    const second = getVersion();
    getVersion();

    expect(first).toBe(second);
    expect(callCount).toBe(callsAfterFirst); // no new FS reads
  });

  it("returns 'unknown' when root package.json cannot be found (ENOENT on all paths)", async () => {
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        readFileSync: (_path: unknown, ..._args: unknown[]) => {
          const err = Object.assign(new Error('ENOENT: no such file or directory'), {
            code: 'ENOENT',
          });
          throw err;
        },
      };
    });

    const { getVersion } = await import('./version.js');
    expect(getVersion()).toBe('unknown');
  });
});
