import { describe, it, expect, vi, beforeEach } from 'vitest';
import { categorizeLightweight, processFull, categorizeContent } from './categorization.js';
import { createLogger } from '@echos/shared';

// Mock fetch for Anthropic API
global.fetch = vi.fn();

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
      const mockResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              category: 'programming',
              tags: ['typescript', 'javascript', 'web-development'],
            }),
          },
        ],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await categorizeLightweight(title, content, testApiKey, logger);

      expect(result.category).toBe('programming');
      expect(result.tags).toEqual(['typescript', 'javascript', 'web-development']);
      expect(global.fetch).toHaveBeenCalledOnce();
    });

    it('should return default values on error', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('API error'));

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

      const mockResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(mockResult),
          },
        ],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await processFull(title, content, testApiKey, logger);

      expect(result.category).toBe('programming');
      expect(result.tags).toEqual(['typescript', 'javascript']);
      expect(result.gist).toBe('TypeScript adds static typing to JavaScript');
      expect(result.summary).toBeDefined();
      expect(result.keyPoints).toHaveLength(3);
    });

    it('should return fallback values on error', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('API error'));

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
      const mockResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              category: 'programming',
              tags: ['typescript'],
            }),
          },
        ],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

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

      const mockResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(mockResult),
          },
        ],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await categorizeContent(title, content, 'full', testApiKey, logger);

      expect(result.category).toBe('programming');
      expect('gist' in result).toBe(true);
      if ('gist' in result) {
        expect(result.gist).toBe('Test gist');
      }
    });
  });
});
