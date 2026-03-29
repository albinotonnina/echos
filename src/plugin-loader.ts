/**
 * Auto-discovers plugins at runtime.
 * Reads the plugins/ directory and dynamically imports each plugin package.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { EchosPlugin } from '@echos/core';

const PLUGIN_NAME_RE = /^[a-z0-9-]+$/;

export async function loadPlugins(logger: Logger): Promise<EchosPlugin[]> {
  const pluginsDir = join(import.meta.dirname, '..', 'plugins');
  const plugins: EchosPlugin[] = [];

  let entries: string[];
  try {
    entries = readdirSync(pluginsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && PLUGIN_NAME_RE.test(d.name))
      .map((d) => d.name)
      .sort();
  } catch (err) {
    logger.warn({ err }, 'Could not read plugins directory');
    return plugins;
  }

  for (const dirname of entries) {
    const moduleName = `@echos/plugin-${dirname}`;
    try {
      const mod = (await import(moduleName)) as { default: EchosPlugin };
      plugins.push(mod.default);
      logger.info({ plugin: moduleName }, 'Loaded plugin');
    } catch (err) {
      logger.warn({ plugin: moduleName, err }, 'Failed to load plugin, skipping');
    }
  }

  return plugins;
}
