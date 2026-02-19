import type { FastifyInstance } from 'fastify';
import type { Agent, AgentMessage } from '@mariozechner/pi-agent-core';
import type { AgentDeps } from '@echos/core';
import { createEchosAgent, isAgentMessageOverflow, createContextMessage, createUserMessage } from '@echos/core';
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
  logger: Logger,
): void {
  // Send a message and get a streamed response
  app.post<{
    Body: { message: string; userId: number };
  }>('/api/chat', async (request, reply) => {
    const { message, userId } = request.body;

    if (!message || !userId) {
      return reply.status(400).send({ error: 'Missing message or userId' });
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

  // Reset session
  app.post<{
    Body: { userId: number };
  }>('/api/chat/reset', async (request, reply) => {
    const { userId } = request.body;
    const agent = sessions.get(userId);
    if (agent) {
      agent.reset();
      sessions.delete(userId);
    }
    return reply.send({ ok: true });
  });

  logger.info('Chat API routes registered');
}
