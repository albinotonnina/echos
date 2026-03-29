import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createLogger, ValidationError, NotFoundError } from '@echos/shared';
import type { NoteMetadata, SearchResult } from '@echos/shared';
import { createSqliteStorage, type SqliteStorage } from '../../storage/sqlite.js';
import { createMarkdownStorage, type MarkdownStorage } from '../../storage/markdown.js';

// Mock pi-ai module for streamSimple + getModel (used by resolveModel)
vi.mock('@mariozechner/pi-ai', () => ({
  Type: {
    Object: vi.fn((obj: unknown) => obj),
    Optional: vi.fn((t: unknown) => t),
    Array: vi.fn((t: unknown) => t),
    String: vi.fn(() => 'string'),
    Number: vi.fn(() => 'number'),
  },
  StringEnum: vi.fn(() => 'string'),
  streamSimple: vi.fn(),
  getModel: vi.fn(() => ({ id: 'claude-haiku-4-5-20251001', provider: 'anthropic' })),
}));

import { streamSimple } from '@mariozechner/pi-ai';
import { createSynthesizeNotesTool } from './synthesize.js';
import type { SynthesizeNotesToolDeps } from './synthesize.js';

const logger = createLogger('test', 'silent');

let tempDir: string;
let sqlite: SqliteStorage;
let markdown: MarkdownStorage;

const mockVectorDb = {
  upsert: async () => {},
  search: async () => [],
  findByVector: async () => [],
  remove: async () => {},
  close: () => {},
};

const mockSearch = {
  keyword: vi.fn((): SearchResult[] => []),
  semantic: vi.fn(async (): Promise<SearchResult[]> => []),
  hybrid: vi.fn(async (): Promise<SearchResult[]> => []),
};

const stubEmbedding = async () => new Array(1536).fill(0);

function makeStream(text: string): AsyncIterable<{ type: string; delta: string }> {
  return (async function* () {
    yield { type: 'text_delta', delta: text };
  })();
}

function makeErrorStream(): AsyncIterable<never> {
  return (async function* () {
    throw new Error('LLM connection failed');
  })();
}

function makeDeps(overrides: Partial<SynthesizeNotesToolDeps> = {}): SynthesizeNotesToolDeps {
  return {
    sqlite,
    markdown,
    vectorDb: mockVectorDb,
    search: mockSearch,
    generateEmbedding: stubEmbedding,
    anthropicApiKey: 'test-key',
    llmApiKey: 'test-key',
    logger,
    ...overrides,
  };
}

function makeMeta(overrides: Partial<NoteMetadata> = {}): NoteMetadata {
  return {
    id: 'note-a',
    type: 'note',
    title: 'Note A',
    created: '2024-01-01T00:00:00Z',
    updated: '2024-01-01T00:00:00Z',
    tags: ['test'],
    links: [],
    category: 'general',
    status: 'read',
    inputSource: 'text',
    ...overrides,
  };
}

function createNote(meta: NoteMetadata, content = 'Some note body'): string {
  const filePath = markdown.save(meta, content);
  sqlite.upsertNote(meta, content, filePath);
  return filePath;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'echos-synthesize-test-'));
  sqlite = createSqliteStorage(join(tempDir, 'test.db'), logger);
  markdown = createMarkdownStorage(join(tempDir, 'knowledge'), logger);
  vi.clearAllMocks();
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('synthesize_notes tool', () => {
  describe('selector validation', () => {
    it('throws ValidationError when no selector is provided', async () => {
      const tool = createSynthesizeNotesTool(makeDeps());

      await expect(
        tool.execute('tc1', { title: 'Synthesis' }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when multiple selectors are provided', async () => {
      const tool = createSynthesizeNotesTool(makeDeps());

      await expect(
        tool.execute('tc1', {
          title: 'Synthesis',
          noteIds: ['a', 'b'],
          query: 'test',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when all three selectors are provided', async () => {
      const tool = createSynthesizeNotesTool(makeDeps());

      await expect(
        tool.execute('tc1', {
          title: 'Synthesis',
          noteIds: ['a'],
          query: 'test',
          tags: ['foo'],
        }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('selection by noteIds', () => {
    it('throws NotFoundError for unknown note ID', async () => {
      const tool = createSynthesizeNotesTool(makeDeps());

      await expect(
        tool.execute('tc1', { title: 'Synthesis', noteIds: ['nonexistent'] }),
      ).rejects.toThrow(NotFoundError);
    });

    it('deduplicates noteIds', async () => {
      createNote(makeMeta({ id: 'note-1', title: 'Note 1' }), 'Content 1');
      createNote(makeMeta({ id: 'note-2', title: 'Note 2' }), 'Content 2');

      vi.mocked(streamSimple).mockReturnValueOnce(
        makeStream('Synthesized text here') as ReturnType<typeof streamSimple>,
      );

      const tool = createSynthesizeNotesTool(makeDeps());
      const result = await tool.execute('tc1', {
        title: 'Dedup Test',
        noteIds: ['note-1', 'note-2', 'note-1', 'note-2'],
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Synthesized from 2 notes');
      // streamSimple prompt should contain only 2 note blocks
      const callArgs = vi.mocked(streamSimple).mock.calls[0];
      const promptMsg = (callArgs![1] as { messages: Array<{ content: string }> }).messages[0]!.content;
      expect((promptMsg.match(/### Note/g) ?? []).length).toBe(2);
    });

    it('respects maxNotes limit', async () => {
      for (let i = 1; i <= 5; i++) {
        createNote(makeMeta({ id: `note-${i}`, title: `Note ${i}` }), `Content ${i}`);
      }

      vi.mocked(streamSimple).mockReturnValueOnce(
        makeStream('Synthesized') as ReturnType<typeof streamSimple>,
      );

      const tool = createSynthesizeNotesTool(makeDeps());
      const result = await tool.execute('tc1', {
        title: 'Max Test',
        noteIds: ['note-1', 'note-2', 'note-3', 'note-4', 'note-5'],
        maxNotes: 3,
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Synthesized from 3 notes');
    });

    it('prefers markdown file content over SQLite', async () => {
      const meta = makeMeta({ id: 'note-md', title: 'Original Title' });
      const filePath = createNote(meta, 'Original content');

      // Update markdown directly so it differs from SQLite
      markdown.update(filePath, { title: 'Updated Title' }, 'Updated content');
      // SQLite still has 'Original content'

      createNote(makeMeta({ id: 'note-2', title: 'Note 2' }), 'Content 2');

      vi.mocked(streamSimple).mockReturnValueOnce(
        makeStream('Synthesized') as ReturnType<typeof streamSimple>,
      );

      const tool = createSynthesizeNotesTool(makeDeps());
      await tool.execute('tc1', {
        title: 'MD Preference Test',
        noteIds: ['note-md', 'note-2'],
      });

      const callArgs = vi.mocked(streamSimple).mock.calls[0];
      const promptMsg = (callArgs![1] as { messages: Array<{ content: string }> }).messages[0]!.content;
      expect(promptMsg).toContain('Updated content');
      expect(promptMsg).toContain('Updated Title');
    });

    it('returns less-than-2 error when only 1 noteId provided', async () => {
      createNote(makeMeta({ id: 'solo', title: 'Solo' }), 'Lonely content');

      const tool = createSynthesizeNotesTool(makeDeps());
      const result = await tool.execute('tc1', {
        title: 'Solo Synth',
        noteIds: ['solo'],
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Need at least 2 notes');
    });
  });

  describe('selection by tags', () => {
    it('selects notes by tags', async () => {
      createNote(makeMeta({ id: 'tag-1', title: 'Tag 1', tags: ['typescript'] }), 'TS content');
      createNote(makeMeta({ id: 'tag-2', title: 'Tag 2', tags: ['typescript'] }), 'TS content 2');

      vi.mocked(streamSimple).mockReturnValueOnce(
        makeStream('Tag synthesis') as ReturnType<typeof streamSimple>,
      );

      const tool = createSynthesizeNotesTool(makeDeps());
      const result = await tool.execute('tc1', {
        title: 'Tags Test',
        tags: ['typescript'],
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Synthesized from 2 notes');
    });
  });

  describe('selection by query', () => {
    it('uses search service for query-based selection', async () => {
      const searchResults: SearchResult[] = [
        {
          note: {
            metadata: {
              id: 'q-1', title: 'Query 1', tags: ['ai'], created: '2024-01-01T00:00:00Z',
              type: 'note', updated: '2024-01-01T00:00:00Z', links: [], category: 'tech',
            },
            content: 'AI content 1',
            filePath: '/tmp/q1.md',
          },
          score: 0.9,
        },
        {
          note: {
            metadata: {
              id: 'q-2', title: 'Query 2', tags: ['ai'], created: '2024-01-02T00:00:00Z',
              type: 'note', updated: '2024-01-02T00:00:00Z', links: [], category: 'tech',
            },
            content: 'AI content 2',
            filePath: '/tmp/q2.md',
          },
          score: 0.8,
        },
      ];

      mockSearch.hybrid.mockResolvedValueOnce(searchResults);
      vi.mocked(streamSimple).mockReturnValueOnce(
        makeStream('Query synthesis') as ReturnType<typeof streamSimple>,
      );

      const tool = createSynthesizeNotesTool(makeDeps());
      const result = await tool.execute('tc1', {
        title: 'Query Test',
        query: 'artificial intelligence',
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Synthesized from 2 notes');
      expect(mockSearch.hybrid).toHaveBeenCalledOnce();
    });
  });

  describe('LLM error handling', () => {
    it('returns user-friendly error when LLM streaming fails', async () => {
      createNote(makeMeta({ id: 'err-1', title: 'Err 1' }), 'Content 1');
      createNote(makeMeta({ id: 'err-2', title: 'Err 2' }), 'Content 2');

      vi.mocked(streamSimple).mockReturnValueOnce(
        makeErrorStream() as ReturnType<typeof streamSimple>,
      );

      const tool = createSynthesizeNotesTool(makeDeps());
      const result = await tool.execute('tc1', {
        title: 'Error Test',
        noteIds: ['err-1', 'err-2'],
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Failed to generate a synthesis');
      expect(text).toContain('language model');
      expect((result.details as { error: string }).error).toBe('llm_stream_error');
    });

    it('returns error when LLM returns empty content', async () => {
      createNote(makeMeta({ id: 'empty-1', title: 'E1' }), 'Content 1');
      createNote(makeMeta({ id: 'empty-2', title: 'E2' }), 'Content 2');

      vi.mocked(streamSimple).mockReturnValueOnce(
        makeStream('  ') as ReturnType<typeof streamSimple>,
      );

      const tool = createSynthesizeNotesTool(makeDeps());
      const result = await tool.execute('tc1', {
        title: 'Empty Test',
        noteIds: ['empty-1', 'empty-2'],
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('empty synthesis');
    });
  });

  describe('bidirectional linking', () => {
    it('creates backlinks from source notes to synthesis', async () => {
      createNote(makeMeta({ id: 'src-1', title: 'Source 1' }), 'Content 1');
      createNote(makeMeta({ id: 'src-2', title: 'Source 2' }), 'Content 2');

      vi.mocked(streamSimple).mockReturnValueOnce(
        makeStream('Linked synthesis') as ReturnType<typeof streamSimple>,
      );

      const tool = createSynthesizeNotesTool(makeDeps());
      const result = await tool.execute('tc1', {
        title: 'Backlink Test',
        noteIds: ['src-1', 'src-2'],
      });

      const synthesisId = (result.details as { id: string }).id;

      // Check source notes have backlink to synthesis
      const row1 = sqlite.getNote('src-1');
      const row2 = sqlite.getNote('src-2');
      expect(row1?.links).toContain(synthesisId);
      expect(row2?.links).toContain(synthesisId);

      // Check synthesis note has forward links to sources
      const synthesisRow = sqlite.getNote(synthesisId);
      expect(synthesisRow?.links).toContain('src-1');
      expect(synthesisRow?.links).toContain('src-2');
    });
  });

  describe('synthesis creation', () => {
    it('creates a synthesis note with aggregated tags', async () => {
      createNote(makeMeta({ id: 'tag-a', title: 'Tag A', tags: ['typescript', 'web'] }), 'A');
      createNote(makeMeta({ id: 'tag-b', title: 'Tag B', tags: ['web', 'react'] }), 'B');

      vi.mocked(streamSimple).mockReturnValueOnce(
        makeStream('Synthesized content') as ReturnType<typeof streamSimple>,
      );

      const tool = createSynthesizeNotesTool(makeDeps());
      const result = await tool.execute('tc1', {
        title: 'Tag Aggregation',
        noteIds: ['tag-a', 'tag-b'],
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('synthesis');
      expect(text).toContain('typescript');
      expect(text).toContain('web');
      expect(text).toContain('react');

      const synthesisId = (result.details as { id: string }).id;
      const row = sqlite.getNote(synthesisId);
      expect(row).toBeDefined();
      expect(row!.tags).toContain('synthesis');
      expect(row!.tags).toContain('typescript');
      expect(row!.tags).toContain('web');
      expect(row!.tags).toContain('react');
    });

    it('persists synthesis to markdown and SQLite', async () => {
      createNote(makeMeta({ id: 'p-1', title: 'P1' }), 'Content 1');
      createNote(makeMeta({ id: 'p-2', title: 'P2' }), 'Content 2');

      vi.mocked(streamSimple).mockReturnValueOnce(
        makeStream('Persisted synthesis content') as ReturnType<typeof streamSimple>,
      );

      const tool = createSynthesizeNotesTool(makeDeps());
      const result = await tool.execute('tc1', {
        title: 'Persistence Test',
        noteIds: ['p-1', 'p-2'],
      });

      const synthesisId = (result.details as { id: string }).id;

      // Check SQLite
      const row = sqlite.getNote(synthesisId);
      expect(row).toBeDefined();
      expect(row!.title).toBe('Persistence Test');
      expect(row!.content).toBe('Persisted synthesis content');

      // Check markdown
      const mdNote = markdown.readById(synthesisId);
      expect(mdNote).toBeDefined();
      expect(mdNote!.content).toBe('Persisted synthesis content');
    });

    it('uses the requested format in the prompt', async () => {
      createNote(makeMeta({ id: 'f-1', title: 'F1' }), 'Content 1');
      createNote(makeMeta({ id: 'f-2', title: 'F2' }), 'Content 2');

      vi.mocked(streamSimple).mockReturnValueOnce(
        makeStream('Timeline content') as ReturnType<typeof streamSimple>,
      );

      const tool = createSynthesizeNotesTool(makeDeps());
      const result = await tool.execute('tc1', {
        title: 'Format Test',
        noteIds: ['f-1', 'f-2'],
        format: 'timeline',
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('format: timeline');

      // Verify the prompt included timeline instructions
      const callArgs = vi.mocked(streamSimple).mock.calls[0];
      const promptMsg = (callArgs![1] as { messages: Array<{ content: string }> }).messages[0]!.content;
      expect(promptMsg).toContain('chronological narrative');
    });
  });

  describe('content truncation', () => {
    it('truncates long note content in the prompt', async () => {
      const longContent = 'A'.repeat(5000);
      createNote(makeMeta({ id: 't-1', title: 'T1' }), longContent);
      createNote(makeMeta({ id: 't-2', title: 'T2' }), 'Short');

      vi.mocked(streamSimple).mockReturnValueOnce(
        makeStream('Truncated synthesis') as ReturnType<typeof streamSimple>,
      );

      const tool = createSynthesizeNotesTool(makeDeps());
      await tool.execute('tc1', {
        title: 'Truncation Test',
        noteIds: ['t-1', 't-2'],
      });

      const callArgs = vi.mocked(streamSimple).mock.calls[0];
      const promptMsg = (callArgs![1] as { messages: Array<{ content: string }> }).messages[0]!.content;
      expect(promptMsg).toContain('[...truncated]');
      // The full 5000 chars should NOT be in the prompt
      expect(promptMsg.length).toBeLessThan(5000 + 500);
    });
  });
});
