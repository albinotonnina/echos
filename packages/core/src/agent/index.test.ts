import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentDeps } from './index.js';

// Must be hoisted before the module under test is imported.
// Spread actual exports so tools that import Type, Static, etc. still work.
vi.mock('@mariozechner/pi-ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mariozechner/pi-ai')>();
  return {
    ...actual,
    streamSimple: vi.fn(),
    getModel: vi.fn((provider: string, modelId: string) => ({
      id: modelId,
      provider,
      api: 'anthropic-messages',
      baseUrl: 'https://api.anthropic.com/v1',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 8096,
    })),
    isContextOverflow: vi.fn(() => false),
  };
});

vi.mock('@mariozechner/pi-agent-core', () => {
  class MockAgent {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    streamFn: ((...args: any[]) => any) | undefined = undefined;
    setSystemPrompt = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
    constructor(_opts: any) {}
  }
  return { Agent: MockAgent };
});

import { createEchosAgent } from './index.js';
import { streamSimple } from '@mariozechner/pi-ai';

function makeMinimalDeps(overrides: Partial<AgentDeps> = {}): AgentDeps {
  return {
    sqlite: {
      listTopMemories: vi.fn().mockReturnValue([]),
      getAgentVoice: vi.fn().mockReturnValue(null),
    } as unknown as AgentDeps['sqlite'],
    markdown: {} as AgentDeps['markdown'],
    vectorDb: {} as AgentDeps['vectorDb'],
    search: {} as AgentDeps['search'],
    generateEmbedding: vi.fn(),
    anthropicApiKey: 'sk-test',
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as AgentDeps['logger'],
    ...overrides,
  };
}

// Invoke the streamFn that createEchosAgent wires onto the agent instance
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function invokeStreamFn(agent: ReturnType<typeof createEchosAgent>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (agent as any).streamFn as ((m: unknown, c: unknown, o: unknown) => void) | undefined;
  fn?.({}, [], {});
}

describe('createEchosAgent — effectiveCacheRetention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to long cacheRetention for Anthropic models', () => {
    const agent = createEchosAgent(makeMinimalDeps({ modelId: 'claude-haiku-4-5-20251001' }));
    invokeStreamFn(agent);
    expect(vi.mocked(streamSimple)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ cacheRetention: 'long' }),
    );
  });

  it('respects an explicit cacheRetention override for Anthropic models', () => {
    const agent = createEchosAgent(
      makeMinimalDeps({ modelId: 'claude-haiku-4-5-20251001', cacheRetention: 'short' }),
    );
    invokeStreamFn(agent);
    expect(vi.mocked(streamSimple)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ cacheRetention: 'short' }),
    );
  });

  it('forces cacheRetention to none for custom endpoints regardless of setting', () => {
    const agent = createEchosAgent(
      makeMinimalDeps({
        anthropicApiKey: undefined,
        llmApiKey: 'custom-key',
        llmBaseUrl: 'https://api.custom.example.com/v1',
        modelId: 'some-model',
        cacheRetention: 'long', // should be overridden to 'none'
      }),
    );
    invokeStreamFn(agent);
    expect(vi.mocked(streamSimple)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ cacheRetention: 'none' }),
    );
  });
});
