import type { FastifyInstance } from 'fastify';
import type { AgentDeps } from '@echos/core';
import { validateContentSize } from '@echos/shared';
import { createUserMessage, resolveModel, MODEL_PRESETS, type ModelPreset } from '@echos/core';
import type { Logger } from 'pino';
import type { SessionManager } from './sessions.js';

export function registerChatSubRoutes(
  app: FastifyInstance,
  sessionManager: SessionManager,
  agentDeps: AgentDeps,
  logger: Logger,
): void {
  // Switch model preset for the session
  app.post<{
    Body: { preset: ModelPreset; userId: number };
  }>('/api/chat/model', async (request, reply) => {
    const { preset, userId } = request.body;
    if (!preset || !userId) {
      return reply.status(400).send({ error: 'Missing preset or userId' });
    }
    if (!sessionManager.isAllowed(userId)) {
      logger.warn({ userId }, 'Unauthorized userId in web model request');
      return reply.status(403).send({ error: 'Forbidden' });
    }
    if (!['fast', 'balanced', 'deep'].includes(preset)) {
      return reply.status(400).send({ error: 'preset must be fast | balanced | deep' });
    }
    const agent = sessionManager.getSession(userId);
    if (!agent) {
      return reply.status(404).send({ error: 'No active session' });
    }
    const presets = agentDeps.modelPresets ?? {};
    const modelSpec =
      preset === 'fast'
        ? (agentDeps.modelId ?? MODEL_PRESETS.fast)
        : preset === 'balanced'
          ? (presets.balanced ?? MODEL_PRESETS.balanced)
          : (presets.deep ?? MODEL_PRESETS.deep);
    agent.state.model = resolveModel(modelSpec);
    return reply.send({ ok: true, model: agent.state.model.id });
  });

  // Steer the running agent mid-turn
  app.post<{
    Body: { message: string; userId: number };
  }>('/api/chat/steer', async (request, reply) => {
    const { message, userId } = request.body;
    if (!message || !userId) {
      return reply.status(400).send({ error: 'Missing message or userId' });
    }
    if (!sessionManager.isAllowed(userId)) {
      logger.warn({ userId }, 'Unauthorized userId in web steer request');
      return reply.status(403).send({ error: 'Forbidden' });
    }
    try {
      validateContentSize(message, { label: 'message' });
    } catch {
      return reply.status(413).send({ error: 'Message exceeds maximum allowed size' });
    }
    const agent = sessionManager.getSession(userId);
    if (!agent) {
      return reply.status(404).send({ error: 'No active session' });
    }
    if (!agent.state.isStreaming) {
      return reply.status(409).send({ error: 'Agent is not currently running' });
    }
    agent.steer(createUserMessage(message));
    return reply.send({ ok: true });
  });

  // Queue a follow-up message
  app.post<{
    Body: { message: string; userId: number };
  }>('/api/chat/followup', async (request, reply) => {
    const { message, userId } = request.body;
    if (!message || !userId) {
      return reply.status(400).send({ error: 'Missing message or userId' });
    }
    if (!sessionManager.isAllowed(userId)) {
      logger.warn({ userId }, 'Unauthorized userId in web followup request');
      return reply.status(403).send({ error: 'Forbidden' });
    }
    try {
      validateContentSize(message, { label: 'message' });
    } catch {
      return reply.status(413).send({ error: 'Message exceeds maximum allowed size' });
    }
    const agent = sessionManager.getSession(userId);
    if (!agent) {
      return reply.status(404).send({ error: 'No active session' });
    }
    agent.followUp(createUserMessage(message));
    return reply.send({ ok: true });
  });

  // Reset session
  app.post<{
    Body: { userId: number };
  }>('/api/chat/reset', async (request, reply) => {
    const { userId } = request.body;
    if (!userId) {
      return reply.status(400).send({ error: 'Missing userId' });
    }
    if (!sessionManager.isAllowed(userId)) {
      logger.warn({ userId }, 'Unauthorized userId in web reset request');
      return reply.status(403).send({ error: 'Forbidden' });
    }
    sessionManager.resetSession(userId);
    return reply.send({ ok: true });
  });
}
