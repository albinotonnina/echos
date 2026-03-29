import type { Agent } from '@mariozechner/pi-agent-core';
import type { AgentDeps } from '@echos/core';
import { createEchosAgent } from '@echos/core';
import type { Logger } from 'pino';

export interface SessionManager {
  getOrCreateAgent(userId: number): Agent;
  resetSession(userId: number): void;
  isAllowed(userId: number): boolean;
  getSession(userId: number): Agent | undefined;
}

export function createSessionManager(
  agentDeps: AgentDeps,
  allowedUserIds: number[],
  logger: Logger,
): SessionManager {
  const sessions = new Map<number, Agent>();
  const allowedSet = new Set(allowedUserIds);

  return {
    getOrCreateAgent(userId: number): Agent {
      let agent = sessions.get(userId);
      if (!agent) {
        agent = createEchosAgent(agentDeps);
        agent.sessionId = `web-${userId}`;
        sessions.set(userId, agent);
        logger.debug({ userId }, 'Created new web agent session');
      }
      return agent;
    },

    resetSession(userId: number): void {
      const agent = sessions.get(userId);
      if (agent) {
        agent.reset();
        sessions.delete(userId);
      }
    },

    isAllowed(userId: number): boolean {
      return allowedSet.has(userId);
    },

    getSession(userId: number): Agent | undefined {
      return sessions.get(userId);
    },
  };
}
