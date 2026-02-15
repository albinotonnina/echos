import type { Agent } from '@mariozechner/pi-agent-core';
import type { AgentDeps } from '@echos/core';
import { createEchosAgent } from '@echos/core';

const sessions = new Map<number, Agent>();

export function getOrCreateSession(userId: number, deps: AgentDeps): Agent {
  let agent = sessions.get(userId);
  if (!agent) {
    agent = createEchosAgent(deps);
    sessions.set(userId, agent);
  }
  return agent;
}

export function clearSession(userId: number): void {
  const agent = sessions.get(userId);
  if (agent) {
    agent.reset();
    sessions.delete(userId);
  }
}

export function clearAllSessions(): void {
  for (const agent of sessions.values()) {
    agent.reset();
  }
  sessions.clear();
}
