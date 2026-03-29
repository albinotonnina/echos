/**
 * Redis TCP pre-flight check.
 * Sends a PING via raw RESP protocol to verify Redis is reachable.
 */

import type { Logger } from 'pino';

export interface RedisCheckResult {
  ok: boolean;
  error?: string;
}

export async function checkRedisConnection(redisUrl: string, log: Logger): Promise<RedisCheckResult> {
  try {
    const url = new URL(redisUrl);
    const host = url.hostname || '127.0.0.1';
    const port = parseInt(url.port || '6379', 10);
    const password = url.password ? decodeURIComponent(url.password) : undefined;
    const isTls = url.protocol === 'rediss:';

    const { createConnection } = await import('node:net');
    const tls = await import('node:tls');

    return new Promise((resolve) => {
      let buffer = '';
      let settled = false;
      let authPending = !!password;

      const socket = isTls
        ? tls.connect({ host, port })
        : createConnection({ host, port });

      function sendPing() {
        if (password && authPending) {
          const encodedLen = Buffer.byteLength(password, 'utf8');
          socket.write(`*2\r\n$4\r\nAUTH\r\n$${encodedLen}\r\n${password}\r\n`);
        } else {
          socket.write('*1\r\n$4\r\nPING\r\n');
        }
      }

      if (isTls) {
        socket.once('secureConnect', sendPing);
      } else {
        socket.once('connect', sendPing);
      }

      socket.setTimeout(3000);

      socket.on('data', (data: Buffer) => {
        if (settled) return;

        buffer += data.toString('utf8');
        const terminatorIndex = buffer.indexOf('\r\n');
        if (terminatorIndex === -1) return;

        const line = buffer.slice(0, terminatorIndex).trim();

        if (authPending && line === '+OK') {
          authPending = false;
          buffer = buffer.slice(terminatorIndex + 2);
          socket.write('*1\r\n$4\r\nPING\r\n');
          return;
        }

        settled = true;
        socket.end();

        if (line === '+PONG') {
          log.debug({ host, port }, 'Redis pre-flight check passed');
          resolve({ ok: true });
        } else {
          const errMsg = line.startsWith('-') ? line.slice(1).trim() : `unexpected response: ${line}`;
          log.debug({ host, port, response: line }, 'Redis responded unexpectedly');
          resolve({ ok: false, error: errMsg });
        }
      });

      socket.on('error', (err: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        log.debug({ host, port, error: err.message }, 'Redis pre-flight check failed');
        resolve({ ok: false, error: err.message });
      });

      socket.on('timeout', () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        log.debug({ host, port }, 'Redis pre-flight check timed out');
        resolve({ ok: false, error: 'connection timed out' });
      });

      socket.on('end', () => {
        if (settled) return;
        settled = true;
        log.debug({ host, port }, 'Redis connection ended before response');
        resolve({ ok: false, error: 'connection closed unexpectedly' });
      });
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
