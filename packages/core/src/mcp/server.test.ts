import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { createMcpServer, type McpServerDeps } from './server.js';

const mockLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  child: function () { return this; },
} as unknown as import('pino').Logger;

const mockDeps: McpServerDeps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sqlite: {} as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  markdown: {} as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vectorDb: {} as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  search: {} as any,
  generateEmbedding: async () => [],
  knowledgeDir: '/tmp',
  dbPath: '/tmp/test.db',
  logger: mockLogger,
};

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.once('error', reject);
  });
}

function httpPost(
  port: number,
  body: unknown,
  extraHeaders: Record<string, string | number> = {},
): Promise<{ status: number; rawBody: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: 'POST',
        path: '/',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...extraHeaders,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, rawBody: Buffer.concat(chunks).toString('utf-8') })
        );
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpMethod(port: number, method: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, method, path: '/' },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const INIT_REQUEST = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.1' },
  },
};

describe('MCP HTTP server', () => {
  let port: number;
  let server: { start(): Promise<void>; stop(): Promise<void> };

  afterEach(async () => {
    await server?.stop();
  });

  describe('without apiKey (open access)', () => {
    beforeEach(async () => {
      port = await getFreePort();
      server = createMcpServer(mockDeps, { port });
      await server.start();
    });

    it('accepts POST without Authorization header', async () => {
      const { status } = await httpPost(port, INIT_REQUEST);
      expect(status).not.toBe(401);
    });

    it('returns 405 for GET requests', async () => {
      const { status } = await httpMethod(port, 'GET');
      expect(status).toBe(405);
    });

    it('returns 405 for DELETE requests', async () => {
      const { status } = await httpMethod(port, 'DELETE');
      expect(status).toBe(405);
    });

    it('returns a 200 JSON-RPC response for initialize', async () => {
      // MCP StreamableHTTP transport requires Accept: application/json, text/event-stream
      const { status, rawBody } = await httpPost(port, INIT_REQUEST, {
        Accept: 'application/json, text/event-stream',
      });
      expect(status).toBe(200);
      // Response may be JSON or SSE; either way it should contain the jsonrpc result
      expect(rawBody).toContain('"jsonrpc"');
      expect(rawBody).toContain('"result"');
    });
  });

  describe('with apiKey (auth required)', () => {
    const apiKey = 'test-secret-key-for-mcp-12345';

    beforeEach(async () => {
      port = await getFreePort();
      server = createMcpServer(mockDeps, { port, apiKey });
      await server.start();
    });

    it('returns 401 when no Authorization header', async () => {
      const { status } = await httpPost(port, INIT_REQUEST);
      expect(status).toBe(401);
    });

    it('returns 401 for wrong Bearer token', async () => {
      const { status } = await httpPost(port, INIT_REQUEST, { Authorization: 'Bearer wrong-token' });
      expect(status).toBe(401);
    });

    it('returns 401 when not using Bearer scheme', async () => {
      const { status } = await httpPost(port, INIT_REQUEST, { Authorization: `Basic ${apiKey}` });
      expect(status).toBe(401);
    });

    it('accepts requests with correct Bearer token', async () => {
      const { status } = await httpPost(port, INIT_REQUEST, { Authorization: `Bearer ${apiKey}` });
      expect(status).not.toBe(401);
    });
  });

  describe('body size limit', () => {
    beforeEach(async () => {
      port = await getFreePort();
      server = createMcpServer(mockDeps, { port });
      await server.start();
    });

    it('returns 413 when Content-Length declares more than 1 MB', async () => {
      const { status } = await new Promise<{ status: number }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            method: 'POST',
            path: '/',
            headers: { 'Content-Type': 'application/json', 'Content-Length': 2_000_000 },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(status).toBe(413);
    });
  });
});
