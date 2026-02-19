import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { Logger } from 'pino';
import type { Config, InterfaceAdapter } from '@echos/shared';
import type { AgentDeps } from '@echos/core';
import { registerChatRoutes } from './api/chat.js';

export interface WebAdapterOptions {
  config: Config;
  agentDeps: AgentDeps;
  logger: Logger;
}

export function createWebAdapter(options: WebAdapterOptions): InterfaceAdapter {
  const { config, agentDeps, logger } = options;

  const app = Fastify({ logger: false });

  return {
    async start(): Promise<void> {
      if (!config.webApiKey) {
        throw new Error(
          'WEB_API_KEY is not set. Set it in .env before enabling the web interface, ' +
          'or run `pnpm wizard` to generate one automatically.',
        );
      }

      // CORS: restrict to localhost only (web UI is self-hosted)
      await app.register(cors, {
        origin: (origin, cb) => {
          if (!origin || /^https?:\/\/localhost(:\d+)?$/.test(origin) || /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) {
            cb(null, true);
          } else {
            cb(new Error('CORS: origin not allowed'), false);
          }
        },
      });

      // Health check — no auth required
      app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

      // API key authentication for all other routes
      app.addHook('preHandler', async (request, reply) => {
        // Match on the registered route path, not the raw URL (avoids query-string false negatives)
        if (request.routeOptions?.url === '/health') return;

        const auth = request.headers['authorization'];
        if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== config.webApiKey) {
          logger.warn({ url: request.url, ip: request.ip }, 'Unauthorized web API request');
          return reply.status(401).send({ error: 'Unauthorized' });
        }
      });

      // Chat API
      registerChatRoutes(app, agentDeps, config.allowedUserIds, logger);

      await app.listen({ port: config.webPort, host: '127.0.0.1' });
      logger.info({ port: config.webPort }, 'Web server started (localhost only)');
    },

    async stop(): Promise<void> {
      logger.info('Stopping web server...');
      await app.close();
    },
  };
}
