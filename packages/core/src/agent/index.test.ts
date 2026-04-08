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

let capturedAgentOpts: unknown;

vi.mock('@mariozechner/pi-agent-core', () => {
  class MockAgent {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    streamFn: ((...args: any[]) => any) | undefined = undefined;
    state = { systemPrompt: '' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(opts: any) {
      capturedAgentOpts = opts;
    }
  }
  return { Agent: MockAgent };
});

import { createEchosAgent } from './index.js';
import { streamSimple } from '@mariozechner/pi-ai';

function makeMinimalDeps(overrides: Partial<AgentDeps> = {}): AgentDeps {
  return {
    sqlite: {
      db: {
        prepare: vi.fn().mockReturnValue({
          run: vi.fn(),
          get: vi.fn(),
          all: vi.fn().mockReturnValue([]),
        }),
      },
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
  fn?.({}, { tools: [], systemPrompt: '' }, {});
}

describe('createEchosAgent — tool registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedAgentOpts = undefined;
  });

  it('registers save_conversation tool when disableCoreTools is false', () => {
    createEchosAgent(makeMinimalDeps());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = (capturedAgentOpts as any)?.initialState?.tools as Array<{ name: string }>;
    expect(tools.some((t) => t.name === 'save_conversation')).toBe(true);
  });

  it('does not register save_conversation tool when disableCoreTools is true', () => {
    createEchosAgent(makeMinimalDeps({ disableCoreTools: true }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = (capturedAgentOpts as any)?.initialState?.tools as Array<{ name: string }>;
    expect(tools.some((t) => t.name === 'save_conversation')).toBe(false);
  });
});

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
    // Omit anthropicApiKey entirely (exactOptionalPropertyTypes disallows explicit undefined)
    const { anthropicApiKey: _omit, ...baseWithoutAnthropicKey } = makeMinimalDeps();
    const agent = createEchosAgent({
      ...baseWithoutAnthropicKey,
      llmApiKey: 'custom-key',
      llmBaseUrl: 'https://api.custom.example.com/v1',
      modelId: 'some-model',
      cacheRetention: 'long', // should be overridden to 'none'
    });
    invokeStreamFn(agent);
    expect(vi.mocked(streamSimple)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ cacheRetention: 'none' }),
    );
  });
});
