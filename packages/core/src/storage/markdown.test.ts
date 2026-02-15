import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createMarkdownStorage, type MarkdownStorage } from './markdown.js';
import { createLogger } from '@echos/shared';
import type { NoteMetadata } from '@echos/shared';

const logger = createLogger('test', 'silent');

let storage: MarkdownStorage;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'echos-md-test-'));
  storage = createMarkdownStorage(tempDir, logger);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeMeta(overrides: Partial<NoteMetadata> = {}): NoteMetadata {
  return {
    id: 'test-1',
    type: 'note',
    title: 'Test Note',
    created: '2024-01-15T10:00:00Z',
    updated: '2024-01-15T10:00:00Z',
    tags: ['test', 'demo'],
    links: [],
    category: 'general',
    ...overrides,
  };
}

describe('MarkdownStorage', () => {
  it('should save and read a note', () => {
    const meta = makeMeta();
    const filePath = storage.save(meta, 'Hello world');

    expect(filePath).toContain('note/general/2024-01-15-test-note.md');

    const note = storage.read(filePath);
    expect(note).toBeDefined();
    expect(note!.metadata.id).toBe('test-1');
    expect(note!.metadata.title).toBe('Test Note');
    expect(note!.metadata.tags).toEqual(['test', 'demo']);
    expect(note!.content).toBe('Hello world');
  });

  it('should read by ID', () => {
    const meta = makeMeta();
    storage.save(meta, 'Content');

    const note = storage.readById('test-1');
    expect(note).toBeDefined();
    expect(note!.metadata.title).toBe('Test Note');
  });

  it('should update a note', () => {
    const meta = makeMeta();
    const filePath = storage.save(meta, 'Original content');

    const updated = storage.update(filePath, { title: 'Updated Title' }, 'New content');
    expect(updated.metadata.title).toBe('Updated Title');
    expect(updated.content).toBe('New content');

    const reread = storage.read(filePath);
    expect(reread!.metadata.title).toBe('Updated Title');
  });

  it('should remove a note', () => {
    const meta = makeMeta();
    const filePath = storage.save(meta, 'Content');

    storage.remove(filePath);
    expect(storage.read(filePath)).toBeUndefined();
    expect(storage.readById('test-1')).toBeUndefined();
  });

  it('should list notes', () => {
    storage.save(makeMeta({ id: 'a', title: 'First' }), 'A');
    storage.save(makeMeta({ id: 'b', title: 'Second' }), 'B');

    const notes = storage.list();
    expect(notes).toHaveLength(2);
  });

  it('should list notes by type', () => {
    storage.save(makeMeta({ id: 'a', type: 'note' }), 'A');
    storage.save(makeMeta({ id: 'b', type: 'journal', title: 'Journal' }), 'B');

    const journals = storage.list('journal');
    expect(journals).toHaveLength(1);
    expect(journals[0]!.metadata.type).toBe('journal');
  });

  it('should preserve optional metadata fields', () => {
    const meta = makeMeta({ sourceUrl: 'https://example.com', author: 'Alice' });
    const filePath = storage.save(meta, 'Content');

    const note = storage.read(filePath);
    expect(note!.metadata.sourceUrl).toBe('https://example.com');
    expect(note!.metadata.author).toBe('Alice');
  });

  it('should handle slug generation for special characters', () => {
    const meta = makeMeta({ title: 'Hello, World! (Part 2)' });
    const filePath = storage.save(meta, 'Content');

    expect(filePath).toContain('hello-world-part-2');
  });
});
