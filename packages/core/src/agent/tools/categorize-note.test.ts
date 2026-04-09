import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCategorizeNoteTool } from './categorize-note.js';
import type { SqliteStorage, NoteRow } from '../../storage/sqlite.js';
import type { MarkdownStorage } from '../../storage/markdown.js';
import type { Note } from '@echos/shared';
import type { VectorStorage } from '../../storage/vectordb.js';
import { createLogger } from '@echos/shared';
import { categorizeContent } from '../categorization.js';

// Mock the categorization module to avoid real AI calls
vi.mock('../categorization.js', () => ({
  categorizeContent: vi.fn(),
  DEFAULT_CATEGORIZATION_MODEL: 'claude-haiku-4-5',
}));

// Mock the auto-linker to avoid vector search calls
vi.mock('../../graph/auto-linker.js', () => ({
  suggestLinks: vi.fn().mockResolvedValue([]),
}));

// Mock the model-resolver
vi.mock('../model-resolver.js', () => ({
  resolveModel: vi.fn().mockReturnValue({ provider: 'anthropic', id: 'claude-haiku-4-5' }),
}));

const logger = createLogger('test', 'silent');

function makeNoteRow(overrides: Partial<NoteRow> = {}): NoteRow {
  return {
    id: 'note-abc',
    type: 'note',
    title: 'My Note',
    content: 'Original SQLite content',
    filePath: '/data/knowledge/note/uncategorized/2025-01-01-my-note.md',
    tags: '',
    links: '',
    category: 'uncategorized',
    sourceUrl: null,
    author: null,
    gist: null,
    created: '2025-01-01T00:00:00.000Z',
    updated: '2025-01-01T00:00:00.000Z',
    contentHash: null,
    status: 'saved',
    inputSource: null,
    imagePath: null,
    imageUrl: null,
    imageMetadata: null,
    ocrText: null,
    deletedAt: null,
    ...overrides,
  };
}

function makeExistingNote(content: string): Note {
  return {
    content,
    filePath: '/data/knowledge/note/uncategorized/2025-01-01-my-note.md',
    metadata: {
      id: 'note-abc',
      type: 'note',
      title: 'My Note',
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-01T00:00:00.000Z',
      tags: [],
      links: [],
      category: 'uncategorized',
    },
  };
}

describe('createCategorizeNoteTool', () => {
  let sqlite: SqliteStorage;
  let markdown: MarkdownStorage;
  let vectorDb: VectorStorage;
  let upsertNote: ReturnType<typeof vi.fn>;
  let markdownSave: ReturnType<typeof vi.fn>;
  let markdownUpdate: ReturnType<typeof vi.fn>;
  let markdownRemove: ReturnType<typeof vi.fn>;
  let vectorUpsert: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    upsertNote = vi.fn();
    markdownSave = vi.fn().mockReturnValue('/data/knowledge/note/programming/2025-01-01-my-note.md');
    markdownUpdate = vi.fn();
    markdownRemove = vi.fn();
    vectorUpsert = vi.fn().mockResolvedValue(undefined);

    sqlite = {
      getNote: vi.fn().mockReturnValue(makeNoteRow()),
      upsertNote,
      getTopTagsWithCounts: vi.fn().mockReturnValue([]),
    } as unknown as SqliteStorage;

    vectorDb = {
      upsert: vectorUpsert,
    } as unknown as VectorStorage;
  });

  it('uses on-disk content when the markdown file has been externally edited', async () => {
    const diskContent = 'Updated content from external editor (Obsidian)';

    // Category stays the same ('uncategorized') → update path is used
    vi.mocked(categorizeContent).mockResolvedValueOnce({
      category: 'uncategorized',
      tags: ['typescript', 'test'],
    });

    markdown = {
      read: vi.fn().mockReturnValue(makeExistingNote(diskContent)),
      update: markdownUpdate,
      remove: markdownRemove,
    } as unknown as MarkdownStorage;

    const tool = createCategorizeNoteTool({
      sqlite,
      markdown,
      vectorDb,
      generateEmbedding: async () => new Array(1536).fill(0),
      anthropicApiKey: 'test-key',
      logger,
    });

    await tool.execute('call-1', { noteId: 'note-abc' });

    // The markdown update should have been called with the disk content (same category → update path)
    expect(markdownUpdate).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      diskContent,
    );

    // SQLite should be updated with disk content, not the stale SQLite content
    expect(upsertNote).toHaveBeenCalledWith(expect.any(Object), diskContent, expect.any(String));

    // Vector embed text should use disk content
    expect(vectorUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(diskContent),
      }),
    );
  });

  it('falls back to SQLite content when the markdown file is missing', async () => {
    const sqliteContent = 'Original SQLite content';

    // Category changes → save path is used (file was missing anyway)
    vi.mocked(categorizeContent).mockResolvedValueOnce({
      category: 'programming',
      tags: ['typescript', 'test'],
    });

    markdown = {
      read: vi.fn().mockReturnValue(undefined),
      save: markdownSave,
      remove: markdownRemove,
    } as unknown as MarkdownStorage;

    const tool = createCategorizeNoteTool({
      sqlite,
      markdown,
      vectorDb,
      generateEmbedding: async () => new Array(1536).fill(0),
      anthropicApiKey: 'test-key',
      logger,
    });

    await tool.execute('call-2', { noteId: 'note-abc' });

    // Since file is missing, save (not update) is used — with SQLite content as fallback
    expect(markdownSave).toHaveBeenCalledWith(expect.any(Object), sqliteContent);
    expect(upsertNote).toHaveBeenCalledWith(expect.any(Object), sqliteContent, expect.any(String));
    expect(vectorUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(sqliteContent),
      }),
    );
  });

  it('does not overwrite disk content with stale SQLite content when category changes', async () => {
    const staleContent = 'Original SQLite content';
    const freshDiskContent = 'Fresh edited content — must be preserved';

    // Category changes from 'uncategorized' to 'programming' → save + remove path
    vi.mocked(categorizeContent).mockResolvedValueOnce({
      category: 'programming',
      tags: ['typescript', 'test'],
    });

    const noteRow = makeNoteRow({ content: staleContent });
    (sqlite.getNote as ReturnType<typeof vi.fn>).mockReturnValue(noteRow);

    markdown = {
      read: vi.fn().mockReturnValue(makeExistingNote(freshDiskContent)),
      save: markdownSave,
      remove: markdownRemove,
    } as unknown as MarkdownStorage;

    const tool = createCategorizeNoteTool({
      sqlite,
      markdown,
      vectorDb,
      generateEmbedding: async () => new Array(1536).fill(0),
      anthropicApiKey: 'test-key',
      logger,
    });

    await tool.execute('call-3', { noteId: 'note-abc' });

    // Disk content must be used, not the stale SQLite content
    expect(markdownSave).toHaveBeenCalledWith(expect.any(Object), freshDiskContent);
    expect(markdownSave).not.toHaveBeenCalledWith(expect.any(Object), staleContent);
    const upsertArgs = upsertNote.mock.calls[0]!;
    expect(upsertArgs[1]).toBe(freshDiskContent);
    expect(upsertArgs[1]).not.toBe(staleContent);
  });
});
