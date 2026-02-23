import { describe, it, expect } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import {
  exportToMarkdown,
  exportToText,
  exportToJson,
  exportToZip,
  makeExportFileName,
  writeExportFile,
  type ExportableNote,
} from './index.js';

function makeNote(overrides: Partial<ExportableNote> = {}): ExportableNote {
  return {
    id: 'test-id-123',
    title: 'My Test Note',
    content: 'This is the note body.',
    rawMarkdown: '---\ntitle: My Test Note\n---\nThis is the note body.',
    fileName: '2025-01-01-my-test-note.md',
    metadata: { id: 'test-id-123', title: 'My Test Note', tags: ['test'] },
    ...overrides,
  };
}

describe('exportToMarkdown', () => {
  it('returns rawMarkdown as-is', () => {
    const note = makeNote({ rawMarkdown: '---\nid: abc\n---\nHello world' });
    expect(exportToMarkdown(note)).toBe('---\nid: abc\n---\nHello world');
  });
});

describe('exportToText', () => {
  it('strips heading markers', () => {
    const note = makeNote({ content: '## My Heading\n\nSome paragraph.' });
    expect(exportToText(note)).toBe('My Heading\n\nSome paragraph.');
  });

  it('strips bold and italic syntax', () => {
    const note = makeNote({ content: '**bold** and *italic* and __also bold__' });
    expect(exportToText(note)).toBe('bold and italic and also bold');
  });

  it('strips inline code backticks', () => {
    const note = makeNote({ content: 'Use `console.log()` here.' });
    expect(exportToText(note)).toBe('Use console.log() here.');
  });

  it('strips fenced code blocks but keeps content', () => {
    const note = makeNote({ content: 'Before\n```js\nconst x = 1;\n```\nAfter' });
    expect(exportToText(note)).toContain('const x = 1;');
    expect(exportToText(note)).not.toContain('```');
  });

  it('strips links, keeping label text', () => {
    const note = makeNote({ content: 'Visit [OpenAI](https://openai.com) for more.' });
    expect(exportToText(note)).toBe('Visit OpenAI for more.');
  });

  it('strips list markers', () => {
    const note = makeNote({ content: '- item one\n- item two\n1. first\n2. second' });
    const result = exportToText(note);
    expect(result).not.toMatch(/^[-*+]\s/m);
    expect(result).not.toMatch(/^\d+\.\s/m);
    expect(result).toContain('item one');
    expect(result).toContain('first');
  });

  it('returns plain text unchanged', () => {
    const note = makeNote({ content: 'Plain text body' });
    expect(exportToText(note)).toBe('Plain text body');
  });
});

describe('exportToJson', () => {
  it('serialises notes as an array of {metadata, content} objects', () => {
    const note = makeNote();
    const result = exportToJson([note]);
    const parsed = JSON.parse(result) as Array<{ metadata: unknown; content: string }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.content).toBe(note.content);
    expect(parsed[0]!.metadata).toEqual(note.metadata);
  });

  it('serialises multiple notes', () => {
    const notes = [makeNote({ id: '1' }), makeNote({ id: '2' })];
    const parsed = JSON.parse(exportToJson(notes)) as unknown[];
    expect(parsed).toHaveLength(2);
  });
});

describe('exportToZip', () => {
  it('returns a valid ZIP buffer containing .md files', async () => {
    const notes = [
      makeNote({ fileName: 'note-a.md', rawMarkdown: '# Note A' }),
      makeNote({ fileName: 'note-b.md', rawMarkdown: '# Note B' }),
    ];
    const buf = await exportToZip(notes);
    expect(buf).toBeInstanceOf(Buffer);

    const zip = await JSZip.loadAsync(buf);
    const fileNames = Object.keys(zip.files);
    expect(fileNames).toContain('note-a.md');
    expect(fileNames).toContain('note-b.md');

    const contentA = await zip.file('note-a.md')!.async('string');
    expect(contentA).toBe('# Note A');
  });

  it('deduplicates filenames with a numeric counter suffix', async () => {
    const notes = [
      makeNote({ id: 'aaa', fileName: 'same-name.md' }),
      makeNote({ id: 'bbb', fileName: 'same-name.md' }),
      makeNote({ id: 'ccc', fileName: 'same-name.md' }),
    ];
    const buf = await exportToZip(notes);
    const zip = await JSZip.loadAsync(buf);
    const fileNames = Object.keys(zip.files);
    expect(fileNames).toContain('same-name.md');
    expect(fileNames).toContain('same-name (2).md');
    expect(fileNames).toContain('same-name (3).md');
  });
});

describe('makeExportFileName', () => {
  it('produces a .md extension for markdown format', () => {
    expect(makeExportFileName('markdown', 'My Note')).toMatch(/\.md$/);
  });

  it('produces a .txt extension for text format', () => {
    expect(makeExportFileName('text', 'My Note')).toMatch(/\.txt$/);
  });

  it('produces a .json extension for json format', () => {
    expect(makeExportFileName('json')).toMatch(/\.json$/);
  });

  it('produces a .zip extension for zip format', () => {
    expect(makeExportFileName('zip')).toMatch(/\.zip$/);
  });

  it('slugifies the note title into the filename', () => {
    const name = makeExportFileName('markdown', 'Hello World! Special #chars');
    expect(name).toMatch(/hello-world-special-chars/);
  });
});

describe('writeExportFile', () => {
  const testDir = join(tmpdir(), `echos-export-test-${Date.now()}`);

  it('creates the directory and writes the file', () => {
    const filePath = writeExportFile('hello content', 'test-export.txt', testDir);
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf8')).toBe('hello content');
  });

  it('accepts a Buffer', () => {
    const buf = Buffer.from('binary data');
    const filePath = writeExportFile(buf, 'test-export.bin', testDir);
    expect(existsSync(filePath)).toBe(true);
  });

  it('cleans up after tests', () => {
    rmSync(testDir, { recursive: true, force: true });
    expect(existsSync(testDir)).toBe(false);
  });
});
