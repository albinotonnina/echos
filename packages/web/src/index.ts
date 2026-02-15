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
      await app.register(cors, { origin: true });

      // Health check
      app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

      // Chat API
      registerChatRoutes(app, agentDeps, logger);

      await app.listen({ port: config.webPort, host: '0.0.0.0' });
      logger.info({ port: config.webPort }, 'Web server started');
    },

    async stop(): Promise<void> {
      logger.info('Stopping web server...');
      await app.close();
    },
  };
}
