import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSaveTweetTool } from './tool.js';
import type { PluginContext } from '@echos/core';

// Mock processor
vi.mock('./processor.js', () => ({
  processTweet: vi.fn().mockResolvedValue({
    title: '@testuser: This is a test tweet',
    content: '> This is a test tweet\n\n— @testuser, January 1, 2024',
    metadata: { type: 'tweet', sourceUrl: 'https://x.com/testuser/status/123', author: '@testuser' },
    embedText: 'Tweet by @testuser\n\nThis is a test tweet',
  }),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: () => 'mock-uuid-1234',
}));

const mockContext: PluginContext = {
  sqlite: {
    upsertNote: vi.fn(),
  },
  markdown: {
    save: vi.fn().mockReturnValue('/data/knowledge/tweet/mock-file.md'),
  },
  vectorDb: {
    upsert: vi.fn().mockResolvedValue(undefined),
  },
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  config: {},
  getAgentDeps: vi.fn(),
  getNotificationService: vi.fn(),
} as unknown as PluginContext;

describe('createSaveTweetTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a tool with correct name and description', () => {
    const tool = createSaveTweetTool(mockContext);
    expect(tool.name).toBe('save_tweet');
    expect(tool.label).toBe('Save Tweet');
    expect(tool.description).toContain('tweet');
    expect(tool.description).toContain('reading list');
  });

  it('executes and saves a tweet', async () => {
    const tool = createSaveTweetTool(mockContext);
    const onUpdate = vi.fn();

    const result = await tool.execute(
      'call-1',
      { url: 'https://x.com/testuser/status/123' },
      undefined as unknown as AbortSignal,
      onUpdate,
    );

    // Check progress updates were sent
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: [{ type: 'text', text: expect.stringContaining('Fetching tweet') }],
      }),
    );

    // Check storage calls
    expect(mockContext.markdown.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'mock-uuid-1234',
        type: 'tweet',
        status: 'read',
        sourceUrl: 'https://x.com/testuser/status/123',
        author: '@testuser',
      }),
      expect.any(String),
    );

    expect(mockContext.sqlite.upsertNote).toHaveBeenCalled();

    // Check embedding was generated
    expect(mockContext.generateEmbedding).toHaveBeenCalled();
    expect(mockContext.vectorDb.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'mock-uuid-1234',
        type: 'tweet',
      }),
    );

    // Check response text
    const text = result.content[0]!.text;
    expect(text).toContain('Saved tweet');
    expect(text).toContain('reading list');
    expect(text).toContain('mock-uuid-1234');
    expect(text).toContain('Category: tweets');
  });

  it('uses custom tags and category', async () => {
    const tool = createSaveTweetTool(mockContext);

    await tool.execute(
      'call-2',
      { url: 'https://x.com/testuser/status/123', tags: ['tech', 'ai'], category: 'research' },
      undefined as unknown as AbortSignal,
      vi.fn(),
    );

    expect(mockContext.markdown.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: ['tech', 'ai'],
        category: 'research',
      }),
      expect.any(String),
    );
  });

  it('handles embedding failure gracefully', async () => {
    const ctx = {
      ...mockContext,
      generateEmbedding: vi.fn().mockRejectedValue(new Error('Embedding service down')),
    } as unknown as PluginContext;

    const tool = createSaveTweetTool(ctx);

    // Should not throw — embedding failure is non-fatal
    const result = await tool.execute(
      'call-3',
      { url: 'https://x.com/testuser/status/123' },
      undefined as unknown as AbortSignal,
      vi.fn(),
    );

    expect(result.content[0]!.text).toContain('Saved tweet');
  });
});
