import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { createMcpServer, type McpServerDeps } from './server.js';
import type { NoteRow } from '../storage/sqlite.js';

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

const TEST_NOTE: NoteRow = {
  id: 'note-abc123',
  type: 'note',
  title: 'My Test Note',
  content: 'Hello from test.',
  filePath: '/nonexistent/test-note.md',
  tags: 'alpha,beta',
  links: '',
  category: 'testing',
  sourceUrl: null,
  author: null,
  gist: 'A short summary.',
  created: '2024-01-15T00:00:00.000Z',
  updated: '2024-01-15T00:00:00.000Z',
  contentHash: null,
  status: null,
  inputSource: null,
  imagePath: null,
  imageUrl: null,
  imageMetadata: null,
  ocrText: null,
  deletedAt: null,
};

const resourceDeps: McpServerDeps = {
  sqlite: {
    listNotes: () => [TEST_NOTE],
    getNote: (id: string) => (id === TEST_NOTE.id ? TEST_NOTE : undefined),
    getTopTagsWithCounts: () => [{ tag: 'alpha', count: 1 }],
    getCategoryFrequencies: () => [{ category: 'testing', count: 1 }],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  markdown: { read: () => undefined } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vectorDb: {} as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  search: {} as any,
  generateEmbedding: async () => [],
  knowledgeDir: '/tmp',
  dbPath: '/tmp/test.db',
  logger: mockLogger,
};

describe('MCP resources', () => {
  let port: number;
  let server: { start(): Promise<void>; stop(): Promise<void> };

  beforeEach(async () => {
    port = await getFreePort();
    server = createMcpServer(resourceDeps, { port });
    await server.start();
  });

  afterEach(async () => {
    await server?.stop();
  });

  it('initialize advertises resources capability', async () => {
    const { status, rawBody } = await httpPost(port, INIT_REQUEST, {
      Accept: 'application/json, text/event-stream',
    });
    expect(status).toBe(200);
    expect(rawBody).toContain('"resources"');
  });

  it('resources/list includes notes:// URIs', async () => {
    const { status, rawBody } = await httpPost(
      port,
      { jsonrpc: '2.0', id: 2, method: 'resources/list', params: {} },
      { Accept: 'application/json, text/event-stream' },
    );
    expect(status).toBe(200);
    expect(rawBody).toContain(`notes://${TEST_NOTE.id}`);
  });

  it('resources/read returns note content for a known note', async () => {
    const { status, rawBody } = await httpPost(
      port,
      { jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: `notes://${TEST_NOTE.id}` } },
      { Accept: 'application/json, text/event-stream' },
    );
    expect(status).toBe(200);
    expect(rawBody).toContain(TEST_NOTE.title);
  });

  it('resources/read returns not-found text for unknown note', async () => {
    const { status, rawBody } = await httpPost(
      port,
      { jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'notes://no-such-id' } },
      { Accept: 'application/json, text/event-stream' },
    );
    expect(status).toBe(200);
    expect(rawBody).toContain('Note not found');
  });
});

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
