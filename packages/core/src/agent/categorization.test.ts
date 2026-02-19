import { describe, it, expect, vi, beforeEach } from 'vitest';
import { categorizeLightweight, processFull, categorizeContent } from './categorization.js';
import { createLogger } from '@echos/shared';

// Mock the pi-ai module since categorization uses streamSimple, not fetch directly
vi.mock('@mariozechner/pi-ai', () => ({
  getModel: vi.fn(() => ({ id: 'claude-3-5-haiku-20241022' })),
  streamSimple: vi.fn(),
  parseStreamingJson: vi.fn((text: string) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return {};
    }
  }),
}));

import { streamSimple } from '@mariozechner/pi-ai';

function makeStream(jsonPayload: unknown): AsyncIterable<{ type: string; delta: string }> {
  const text = JSON.stringify(jsonPayload);
  return (async function* () {
    yield { type: 'text_delta', delta: text };
  })();
}

function makeErrorStream(): AsyncIterable<never> {
  return (async function* () {
    throw new Error('API error');
  })();
}

describe('Categorization Service', () => {
  const logger = createLogger('test');
  const testApiKey = 'test-api-key';
  const title = 'Introduction to TypeScript';
  const content = 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript...';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('categorizeLightweight', () => {
    it('should return category and tags on success', async () => {
      vi.mocked(streamSimple).mockReturnValueOnce(
        makeStream({ category: 'programming', tags: ['typescript', 'javascript', 'web-development'] }) as ReturnType<typeof streamSimple>,
      );

      const result = await categorizeLightweight(title, content, testApiKey, logger);

      expect(result.category).toBe('programming');
      expect(result.tags).toEqual(['typescript', 'javascript', 'web-development']);
      expect(streamSimple).toHaveBeenCalledOnce();
    });

    it('should return default values on error', async () => {
      vi.mocked(streamSimple).mockReturnValueOnce(makeErrorStream() as ReturnType<typeof streamSimple>);

      const result = await categorizeLightweight(title, content, testApiKey, logger);

      expect(result.category).toBe('uncategorized');
      expect(result.tags).toEqual([]);
    });
  });

  describe('processFull', () => {
    it('should return full processing result on success', async () => {
      const mockResult = {
        category: 'programming',
        tags: ['typescript', 'javascript'],
        gist: 'TypeScript adds static typing to JavaScript',
        summary: 'TypeScript is a powerful language that extends JavaScript with type safety...',
        keyPoints: ['Static typing', 'Compiles to JavaScript', 'Better tooling'],
      };

      vi.mocked(streamSimple).mockReturnValueOnce(makeStream(mockResult) as ReturnType<typeof streamSimple>);

      const result = await processFull(title, content, testApiKey, logger);

      expect(result.category).toBe('programming');
      expect(result.tags).toEqual(['typescript', 'javascript']);
      expect(result.gist).toBe('TypeScript adds static typing to JavaScript');
      expect(result.summary).toBeDefined();
      expect(result.keyPoints).toHaveLength(3);
    });

    it('should return fallback values on error', async () => {
      vi.mocked(streamSimple).mockReturnValueOnce(makeErrorStream() as ReturnType<typeof streamSimple>);

      const result = await processFull(title, content, testApiKey, logger);

      expect(result.category).toBe('uncategorized');
      expect(result.tags).toEqual([]);
      expect(result.gist).toBe(title.slice(0, 100));
      expect(result.summary).toBe(content.slice(0, 500));
      expect(result.keyPoints).toEqual([]);
    });
  });

  describe('categorizeContent', () => {
    it('should call categorizeLightweight for lightweight mode', async () => {
      vi.mocked(streamSimple).mockReturnValueOnce(
        makeStream({ category: 'programming', tags: ['typescript'] }) as ReturnType<typeof streamSimple>,
      );

      const result = await categorizeContent(title, content, 'lightweight', testApiKey, logger);

      expect(result.category).toBe('programming');
      expect('gist' in result).toBe(false);
    });

    it('should call processFull for full mode', async () => {
      const mockResult = {
        category: 'programming',
        tags: ['typescript'],
        gist: 'Test gist',
        summary: 'Test summary',
        keyPoints: ['Point 1'],
      };

      vi.mocked(streamSimple).mockReturnValueOnce(makeStream(mockResult) as ReturnType<typeof streamSimple>);

      const result = await categorizeContent(title, content, 'full', testApiKey, logger);

      expect(result.category).toBe('programming');
      expect('gist' in result).toBe(true);
      if ('gist' in result) {
        expect(result.gist).toBe('Test gist');
      }
    });
  });
});
