/**
 * Liveness heartbeat.
 * Periodically touches a file so the Docker healthcheck can detect a wedged
 * event loop without depending on the (optional) web interface's /health
 * endpoint, which is unavailable whenever ENABLE_WEB=false.
 */

import { writeFile } from 'node:fs/promises';
import type { Logger } from 'pino';

export const HEARTBEAT_PATH = '/tmp/echos-heartbeat';
const HEARTBEAT_INTERVAL_MS = 15_000;

export interface Heartbeat {
  stop(): void;
}

export function startHeartbeat(logger: Logger): Heartbeat {
  const beat = (): void => {
    writeFile(HEARTBEAT_PATH, String(Date.now())).catch((err: unknown) => {
      logger.warn({ err }, 'Failed to write heartbeat file');
    });
  };

  beat();
  const interval = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  interval.unref();

  return {
    stop(): void {
      clearInterval(interval);
    },
  };
}
