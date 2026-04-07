import type { FastifyInstance } from 'fastify';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { AgentDeps } from '@echos/core';
import { isAgentMessageOverflow, createContextMessage, createUserMessage } from '@echos/core';
import { validateContentSize } from '@echos/shared';
import type { Logger } from 'pino';
import { createSessionManager } from './sessions.js';
import { registerChatSubRoutes } from './chat-routes.js';

export function registerChatRoutes(
  app: FastifyInstance,
  agentDeps: AgentDeps,
  allowedUserIds: number[],
  logger: Logger,
): void {
  const sessionManager = createSessionManager(agentDeps, allowedUserIds, logger);

  // Main streaming chat endpoint
  app.post<{
    Body: { message: string; userId: number };
  }>('/api/chat', async (request, reply) => {
    const { message, userId } = request.body;

    if (!message || !userId) {
      return reply.status(400).send({ error: 'Missing message or userId' });
    }
    if (!sessionManager.isAllowed(userId)) {
      logger.warn({ userId }, 'Unauthorized userId in web chat request');
      return reply.status(403).send({ error: 'Forbidden' });
    }
    try {
      validateContentSize(message, { label: 'message' });
    } catch {
      return reply.status(413).send({ error: 'Message exceeds maximum allowed size' });
    }

    const agent = sessionManager.getOrCreateAgent(userId);

    // Collect response
    let responseText = '';
    let lastAssistantMessage: AgentMessage | undefined;
    const toolCalls: Array<{ name: string; result: string }> = [];
    let toolExecuted = false;
    let pendingToolContent = '';

    const unsubscribe = agent.subscribe((event) => {
      if (event.type === 'message_update' && 'assistantMessageEvent' in event) {
        const ame = event.assistantMessageEvent;
        if (ame.type === 'text_delta') {
          if (toolExecuted) {
            responseText = '';
            toolExecuted = false;
          }
          responseText += ame.delta;
        }
      }
      if (event.type === 'message_end' && 'message' in event) {
        lastAssistantMessage = event.message;
      }
      if (event.type === 'tool_execution_start') {
        toolExecuted = true;
      }
      if (event.type === 'tool_execution_end') {
        toolCalls.push({
          name: event.toolName,
          result: event.isError ? 'error' : 'success',
        });
        if (!event.isError && event.toolName === 'create_content') {
          try {
            const resultContent = (event.result as { content?: Array<{ type: string; text?: string }> } | undefined)
              ?.content;
            const textContent = resultContent?.find((c) => c.type === 'text');
            if (textContent?.text) {
              pendingToolContent = textContent.text;
            }
          } catch {
            // ignore
          }
        }
      }
    });

    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      await agent.prompt([
        createContextMessage(`Current date/time: ${now.toISOString()} (${now.toLocaleString('en-US', { timeZone: tz })} ${tz})`),
        createUserMessage(message),
      ]);
    } finally {
      unsubscribe();
    }

    // Check for agent errors (pi-agent-core swallows errors internally)
    const agentError = agent.state.errorMessage;
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

    // If a tool ran but no post-tool text arrived (toolExecuted still true), the agent's
    // responseText contains only pre-tool thinking — prefer the tool's own output instead.
    const finalResponse = toolExecuted
      ? (pendingToolContent || responseText.trim())
      : (responseText.trim() || pendingToolContent);

    return reply.send({
      response: finalResponse,
      toolCalls,
    });
  });

  // Register secondary chat routes (model, steer, followup, reset)
  registerChatSubRoutes(app, sessionManager, agentDeps, logger);

  logger.info('Chat API routes registered');
}
