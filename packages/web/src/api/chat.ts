import type { FastifyInstance } from 'fastify';
import type { Agent, AgentMessage } from '@mariozechner/pi-agent-core';
import type { AgentDeps } from '@echos/core';
import { createEchosAgent, isAgentMessageOverflow, createContextMessage, createUserMessage, resolveModel, MODEL_PRESETS, type ModelPreset } from '@echos/core';
import type { Logger } from 'pino';

const sessions = new Map<number, Agent>();

function getOrCreateAgent(userId: number, deps: AgentDeps): Agent {
  let agent = sessions.get(userId);
  if (!agent) {
    agent = createEchosAgent(deps);
    agent.sessionId = `web-${userId}`;
    sessions.set(userId, agent);
  }
  return agent;
}

export function registerChatRoutes(
  app: FastifyInstance,
  agentDeps: AgentDeps,
  allowedUserIds: number[],
  logger: Logger,
): void {
  const allowedSet = new Set(allowedUserIds);

  function isAllowed(userId: number): boolean {
    return allowedSet.has(userId);
  }

  // Send a message and get a streamed response
  app.post<{
    Body: { message: string; userId: number };
  }>('/api/chat', async (request, reply) => {
    const { message, userId } = request.body;

    if (!message || !userId) {
      return reply.status(400).send({ error: 'Missing message or userId' });
    }
    if (!isAllowed(userId)) {
      logger.warn({ userId }, 'Unauthorized userId in web chat request');
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const agent = getOrCreateAgent(userId, agentDeps);

    // Collect response
    let responseText = '';
    let lastAssistantMessage: AgentMessage | undefined;
    const toolCalls: Array<{ name: string; result: string }> = [];

    const unsubscribe = agent.subscribe((event) => {
      if (event.type === 'message_update' && 'assistantMessageEvent' in event) {
        const ame = event.assistantMessageEvent;
        if (ame.type === 'text_delta') {
          responseText += ame.delta;
        }
      }
      if (event.type === 'message_end' && 'message' in event) {
        lastAssistantMessage = event.message;
      }
      if (event.type === 'tool_execution_end') {
        toolCalls.push({
          name: event.toolName,
          result: event.isError ? 'error' : 'success',
        });
      }
    });

    const now = new Date();
    try {
      await agent.prompt([
        createContextMessage(`Current date/time: ${now.toISOString()} (${now.toLocaleString('en-US', { timeZone: 'UTC' })} UTC)`),
        createUserMessage(message),
      ]);
    } finally {
      unsubscribe();
    }

    // Check for agent errors (pi-agent-core swallows errors internally)
    const agentError = agent.state.error;
    if (!responseText && agentError) {
      const isOverflow = isAgentMessageOverflow(lastAssistantMessage, agent.state.model.contextWindow);
      return reply.status(isOverflow ? 413 : 500).send({
        response: '',
        error: isOverflow
          ? 'Conversation history is too long. Please reset your session.'
          : agentError,
        toolCalls,
      });
    }

    return reply.send({
      response: responseText,
      toolCalls,
    });
  });

  // Switch model preset for the session
  app.post<{
    Body: { preset: ModelPreset; userId: number };
  }>('/api/chat/model', async (request, reply) => {
    const { preset, userId } = request.body;
    if (!preset || !userId) {
      return reply.status(400).send({ error: 'Missing preset or userId' });
    }
    if (!isAllowed(userId)) {
      logger.warn({ userId }, 'Unauthorized userId in web model request');
      return reply.status(403).send({ error: 'Forbidden' });
    }
    if (!['fast', 'balanced', 'deep'].includes(preset)) {
      return reply.status(400).send({ error: 'preset must be fast | balanced | deep' });
    }
    const agent = sessions.get(userId);
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
    agent.setModel(resolveModel(modelSpec));
    return reply.send({ ok: true, model: agent.state.model.id });
  });

  // Steer the running agent mid-turn (interrupt after current tool, skip remaining)
  app.post<{
    Body: { message: string; userId: number };
  }>('/api/chat/steer', async (request, reply) => {
    const { message, userId } = request.body;
    if (!message || !userId) {
      return reply.status(400).send({ error: 'Missing message or userId' });
    }
    if (!isAllowed(userId)) {
      logger.warn({ userId }, 'Unauthorized userId in web steer request');
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const agent = sessions.get(userId);
    if (!agent) {
      return reply.status(404).send({ error: 'No active session' });
    }
    if (!agent.state.isStreaming) {
      return reply.status(409).send({ error: 'Agent is not currently running' });
    }
    agent.steer(createUserMessage(message));
    return reply.send({ ok: true });
  });

  // Queue a follow-up message to run after the current agent turn completes
  app.post<{
    Body: { message: string; userId: number };
  }>('/api/chat/followup', async (request, reply) => {
    const { message, userId } = request.body;
    if (!message || !userId) {
      return reply.status(400).send({ error: 'Missing message or userId' });
    }
    if (!isAllowed(userId)) {
      logger.warn({ userId }, 'Unauthorized userId in web followup request');
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const agent = sessions.get(userId);
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
    if (!isAllowed(userId)) {
      logger.warn({ userId }, 'Unauthorized userId in web reset request');
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const agent = sessions.get(userId);
    if (agent) {
      agent.reset();
      sessions.delete(userId);
    }
    return reply.send({ ok: true });
  });

  logger.info('Chat API routes registered');
}
