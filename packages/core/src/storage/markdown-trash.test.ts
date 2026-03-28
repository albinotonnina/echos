import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pino } from 'pino';
import { createMarkdownStorage } from './markdown.js';
import type { NoteMetadata } from '@echos/shared';

const logger = pino({ level: 'silent' });
let baseDir: string;

function makeMeta(overrides: Partial<NoteMetadata> = {}): NoteMetadata {
  return {
    id: 'test-1',
    type: 'note',
    title: 'Test Note',
    created: '2025-01-01T00:00:00.000Z',
    updated: '2025-01-01T00:00:00.000Z',
    tags: ['test'],
    links: [],
    category: 'uncategorized',
    ...overrides,
  };
}

beforeEach(() => {
  baseDir = join(tmpdir(), `echos-md-trash-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(baseDir, { recursive: true });
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe('Markdown .trash/ operations', () => {
  it('moveToTrash creates .trash/ with preserved relative structure', () => {
    const md = createMarkdownStorage(baseDir, logger);
    const meta = makeMeta();
    const filePath = md.save(meta, 'Hello world');

    expect(existsSync(filePath)).toBe(true);

    const trashPath = md.moveToTrash(filePath);

    expect(trashPath).toContain('/.trash/');
    expect(existsSync(trashPath)).toBe(true);
    expect(existsSync(filePath)).toBe(false);
  });

  it('readById still works after moveToTrash (index updated)', () => {
    const md = createMarkdownStorage(baseDir, logger);
    const meta = makeMeta();
    md.save(meta, 'Hello world');

    const filePath = md.save(meta, 'Hello world');
    md.moveToTrash(filePath);

    const note = md.readById('test-1');
    expect(note).toBeDefined();
    expect(note!.content).toBe('Hello world');
    expect(note!.filePath).toContain('/.trash/');
  });

  it('restoreFromTrash moves file back and updates indexes', () => {
    const md = createMarkdownStorage(baseDir, logger);
    const meta = makeMeta();
    const originalPath = md.save(meta, 'Restore me');

    const trashPath = md.moveToTrash(originalPath);
    expect(existsSync(trashPath)).toBe(true);
    expect(existsSync(originalPath)).toBe(false);

    md.restoreFromTrash(trashPath, originalPath);
    expect(existsSync(originalPath)).toBe(true);
    expect(existsSync(trashPath)).toBe(false);

    const note = md.readById('test-1');
    expect(note).toBeDefined();
    expect(note!.filePath).toBe(originalPath);
  });

  it('purge removes file and clears index entry', () => {
    const md = createMarkdownStorage(baseDir, logger);
    const meta = makeMeta();
    const filePath = md.save(meta, 'Purge me');

    const trashPath = md.moveToTrash(filePath);
    expect(existsSync(trashPath)).toBe(true);

    md.purge(trashPath);
    expect(existsSync(trashPath)).toBe(false);
    expect(md.readById('test-1')).toBeUndefined();
  });

  it('scans .trash/ on startup and indexes trashed files', () => {
    // Create a file and move it to trash
    const md1 = createMarkdownStorage(baseDir, logger);
    const meta = makeMeta();
    const filePath = md1.save(meta, 'Trashed content');
    md1.moveToTrash(filePath);

    // Re-create storage (simulating restart) — should scan .trash/
    const md2 = createMarkdownStorage(baseDir, logger);
    const note = md2.readById('test-1');
    expect(note).toBeDefined();
    expect(note!.content).toBe('Trashed content');
    expect(note!.filePath).toContain('/.trash/');
  });
});
