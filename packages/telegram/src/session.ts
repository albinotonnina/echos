import type { Agent } from '@mariozechner/pi-agent-core';
import type { AgentDeps } from '@echos/core';
import { createEchosAgent } from '@echos/core';

interface SessionState {
  agent: Agent;
  lastActivity: number;
}

const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

const sessions = new Map<number, SessionState>();

export function getOrCreateSession(userId: number, deps: AgentDeps): Agent {
  const now = Date.now();
  const existing = sessions.get(userId);

  if (existing) {
    // Check for inactivity timeout
    if (now - existing.lastActivity > SESSION_TIMEOUT_MS) {
      existing.agent.reset();
      const agent = createEchosAgent(deps);
      agent.sessionId = `telegram-${userId}`;
      sessions.set(userId, { agent, lastActivity: now });
      return agent;
    }
    existing.lastActivity = now;
    return existing.agent;
  }

  const agent = createEchosAgent(deps);
  agent.sessionId = `telegram-${userId}`;
  sessions.set(userId, { agent, lastActivity: now });
  return agent;
}

/** Read-only accessor — does not create a session or update the activity timestamp. */
export function getSession(userId: number): Agent | undefined {
  const state = sessions.get(userId);
  return state?.agent;
}

export function clearSession(userId: number): void {
  const state = sessions.get(userId);
  if (state) {
    state.agent.reset();
    sessions.delete(userId);
  }
}

export function clearAllSessions(): void {
  for (const state of sessions.values()) {
    state.agent.reset();
  }
  sessions.clear();
}
