import { createServer, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod';
import type { Logger } from 'pino';
import type { SqliteStorage } from '../storage/sqlite.js';
import type { MarkdownStorage } from '../storage/markdown.js';
import type { VectorStorage } from '../storage/vectordb.js';
import type { SearchService } from '../storage/search.js';
import { timingSafeStringEqual } from '@echos/shared';
import {
  searchKnowledgeTool,
  createNoteTool,
  getNoteTool,
  listNotesTool,
  findSimilarTool,
  createKnowledgeStatsTool,
  recallKnowledgeTool,
} from '../agent/tools/index.js';
import { registerResources } from './resources.js';

export interface McpServerDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
  vectorDb: VectorStorage;
  search: SearchService;
  generateEmbedding: (text: string) => Promise<number[]>;
  knowledgeDir: string;
  dbPath: string;
  logger: Logger;
}

export interface McpServerOptions {
  port: number;
  apiKey?: string;
}

function buildMcpServer(deps: McpServerDeps, version: string): McpServer {
  const server = new McpServer(
    { name: 'echos', version },
    { capabilities: { tools: {}, resources: {} } },
  );

  const storageDeps = {
    sqlite: deps.sqlite,
    markdown: deps.markdown,
    vectorDb: deps.vectorDb,
    generateEmbedding: deps.generateEmbedding,
  };

  // Instantiate the underlying agent tools to reuse their execute logic
  const searchTool = searchKnowledgeTool({ search: deps.search, generateEmbedding: deps.generateEmbedding });
  const createTool = createNoteTool(storageDeps);
  const getTool = getNoteTool({ sqlite: deps.sqlite, markdown: deps.markdown });
  const listTool = listNotesTool({ sqlite: deps.sqlite });
  const similarTool = findSimilarTool(storageDeps);
  const statsTool = createKnowledgeStatsTool({ sqlite: deps.sqlite, knowledgeDir: deps.knowledgeDir, dbPath: deps.dbPath });
  const recallTool = recallKnowledgeTool({ sqlite: deps.sqlite });

  // search_knowledge
  server.registerTool('search_knowledge', {
    description: searchTool.description,
    inputSchema: {
      query: z.string().min(1).describe('Search query'),
      mode: z.enum(['hybrid', 'keyword', 'semantic']).optional().describe('Search mode. Default: hybrid'),
      type: z.enum(['note', 'journal', 'article', 'youtube', 'tweet', 'reminder']).optional().describe('Filter by content type'),
      limit: z.number().min(1).max(50).optional().describe('Max results to return (default: 10)'),
      temporalDecay: z.boolean().optional().describe('Apply temporal decay to boost recent notes (default: true)'),
      decayHalfLifeDays: z.number().min(1).max(3650).optional().describe('Half-life for temporal decay in days (default: 90)'),
      rerank: z.boolean().optional().describe('Enable AI reranking for highest-quality results (default: false)'),
    },
  }, async (params) => {
    const result = await searchTool.execute(randomUUID(), {
      query: params.query,
      mode: params.mode,
      type: params.type,
      limit: params.limit,
      temporalDecay: params.temporalDecay,
      decayHalfLifeDays: params.decayHalfLifeDays,
      rerank: params.rerank,
    } as Parameters<typeof searchTool.execute>[1]);
    return { content: result.content };
  });

  // create_note
  server.registerTool('create_note', {
    description: 'Create a new note in the knowledge base.',
    inputSchema: {
      title: z.string().min(1).describe('Note title'),
      content: z.string().describe('Note content in markdown'),
      tags: z.array(z.string()).optional().describe('Tags for categorization'),
      category: z.string().optional().describe('Category (e.g., "programming", "health")'),
    },
  }, async (params) => {
    const result = await createTool.execute(randomUUID(), {
      title: params.title,
      content: params.content,
      tags: params.tags,
      category: params.category,
    } as Parameters<typeof createTool.execute>[1]);
    return { content: result.content };
  });

  // get_note
  server.registerTool('get_note', {
    description: getTool.description,
    inputSchema: {
      id: z.string().describe('Note ID (UUID)'),
    },
  }, async (params) => {
    const result = await getTool.execute(randomUUID(), { id: params.id } as Parameters<typeof getTool.execute>[1]);
    return { content: result.content };
  });

  // list_notes
  server.registerTool('list_notes', {
    description: listTool.description,
    inputSchema: {
      type: z.enum(['note', 'journal', 'article', 'youtube', 'tweet', 'reminder', 'conversation']).optional().describe('Filter by content type'),
      status: z.enum(['saved', 'read', 'archived']).optional().describe('Filter by content status'),
      dateFrom: z.string().optional().describe('Return notes created on or after this date (ISO 8601)'),
      dateTo: z.string().optional().describe('Return notes created on or before this date (ISO 8601)'),
      limit: z.number().min(1).optional().describe('Max notes to return (default: 20)'),
      offset: z.number().min(0).optional().describe('Pagination offset (default: 0)'),
    },
  }, async (params) => {
    const result = await listTool.execute(randomUUID(), {
      type: params.type,
      status: params.status,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      limit: params.limit,
      offset: params.offset,
    } as Parameters<typeof listTool.execute>[1]);
    return { content: result.content };
  });

  // find_similar
  server.registerTool('find_similar', {
    description: similarTool.description,
    inputSchema: {
      noteId: z.string().describe('The ID of the reference note to find similar notes for'),
      limit: z.number().min(1).max(50).optional().describe('Maximum number of similar notes to return (default: 5)'),
    },
  }, async (params) => {
    const result = await similarTool.execute(randomUUID(), {
      noteId: params.noteId,
      limit: params.limit,
    } as Parameters<typeof similarTool.execute>[1]);
    return { content: result.content };
  });

  // knowledge_stats
  server.registerTool('knowledge_stats', {
    description: statsTool.description,
  }, async () => {
    const result = await statsTool.execute(randomUUID(), {} as Parameters<typeof statsTool.execute>[1]);
    return { content: result.content };
  });

  // recall_knowledge
  server.registerTool('recall_knowledge', {
    description: recallTool.description,
    inputSchema: {
      topic: z.string().describe('Topic to recall knowledge about'),
    },
  }, async (params) => {
    const result = await recallTool.execute(randomUUID(), { topic: params.topic } as Parameters<typeof recallTool.execute>[1]);
    return { content: result.content };
  });

  registerResources(server, { sqlite: deps.sqlite, markdown: deps.markdown });

  return server;
}

function getPackageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? '0.1.0';
  } catch {
    return '0.1.0';
  }
}

export interface McpAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createMcpServer(deps: McpServerDeps, options: McpServerOptions): McpAdapter {
  const { port, apiKey } = options;
  const { logger } = deps;

  let httpServer: HttpServer | null = null;
  const version = getPackageVersion();

  return {
    async start(): Promise<void> {
      httpServer = createServer(async (req, res) => {
        // Auth check
        if (apiKey) {
          const authHeader = req.headers['authorization'];
          const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
          if (!token || !timingSafeStringEqual(token, apiKey)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null }));
            return;
          }
        }

        if (req.method === 'POST') {
          const MAX_BODY_SIZE = 1_048_576; // 1 MB
          const declaredLength = Number(req.headers['content-length'] ?? 0);
          if (!isNaN(declaredLength) && declaredLength > MAX_BODY_SIZE) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Request body too large' }, id: null }));
            return;
          }

          const mcpServer = buildMcpServer(deps, version);
          // Stateless mode: omit sessionIdGenerator so no session ID is generated or tracked
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const transport = new StreamableHTTPServerTransport({} as any);

          let cleaned = false;
          const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            transport.close().catch(() => {});
            mcpServer.close().catch(() => {});
          };

          try {
            // Parse body with a running size guard
            const chunks: Buffer[] = [];
            let totalSize = 0;
            for await (const chunk of req) {
              totalSize += (chunk as Buffer).length;
              if (totalSize > MAX_BODY_SIZE) {
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Request body too large' }, id: null }));
                return;
              }
              chunks.push(chunk as Buffer);
            }
            const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

            // Cast needed: exactOptionalPropertyTypes causes Transport interface mismatch with SDK types
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await mcpServer.connect(transport as any);
            // Attach listeners before handleRequest so early disconnects are not missed
            res.on('close', cleanup);
            res.on('finish', cleanup);
            await transport.handleRequest(req, res, body);
          } catch (err) {
            logger.error({ err }, 'MCP request error');
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }));
            }
          } finally {
            cleanup();
          }
        } else {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
        }
      });

      await new Promise<void>((resolve, reject) => {
        httpServer!.listen(port, '127.0.0.1', () => resolve());
        httpServer!.once('error', reject);
      });

      logger.info({ port }, 'MCP server started (localhost only)');
    },

    async stop(): Promise<void> {
      if (!httpServer) return;
      await new Promise<void>((resolve, reject) => {
        httpServer!.close((err) => (err ? reject(err) : resolve()));
      });
      httpServer = null;
      logger.info('MCP server stopped');
    },
  };
}
