/**
 * Graceful shutdown handler.
 * Closes all resources in the correct order.
 */

import type { Logger } from 'pino';
import type { InterfaceAdapter } from '@echos/shared';
import type { PluginRegistry, FileWatcher } from '@echos/core';
import type { QueueService } from '@echos/scheduler';

export interface ShutdownResources {
  worker?: { close(): Promise<void> };
  queueService?: QueueService;
  fileWatcher: FileWatcher;
  interfaces: InterfaceAdapter[];
  pluginRegistry: PluginRegistry;
  sqlite: { close(): void };
  vectorDb: { close(): void };
  logger: Logger;
}

export function createShutdownHandler(resources: ShutdownResources): () => Promise<void> {
  return async () => {
    resources.logger.info('Shutting down...');

    if (resources.worker) {
      await resources.worker.close();
      resources.logger.info('Worker closed');
    }
    if (resources.queueService) {
      await resources.queueService.close();
    }

    await resources.fileWatcher.stop();

    for (const iface of resources.interfaces) {
      await iface.stop();
    }
    await resources.pluginRegistry.teardownAll();
    resources.sqlite.close();
    resources.vectorDb.close();
    process.exit(0);
  };
}
