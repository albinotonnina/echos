import { mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import JSZip from 'jszip';

export interface ExportFileResult {
  type: 'export_file';
  filePath: string;
  fileName: string;
  format: 'markdown' | 'json' | 'text' | 'zip';
  noteCount: number;
  /** Inline content for single-note markdown/text exports (no file written to disk) */
  inline?: string;
}

export interface ExportableNote {
  id: string;
  title: string;
  /** Markdown body without frontmatter */
  content: string;
  /** Full file content: YAML frontmatter + markdown body */
  rawMarkdown: string;
  /** Safe filename for use as ZIP entry or download name */
  fileName: string;
  /** Full metadata object for JSON export */
  metadata: Record<string, unknown>;
}

export function exportToMarkdown(note: ExportableNote): string {
  return note.rawMarkdown;
}

/** Strip markdown syntax, returning readable plain text. */
function stripMarkdown(md: string): string {
  return md
    // Fenced code blocks → keep content, remove fences
    .replace(/^```[^\n]*\n([\s\S]*?)^```/gm, '$1')
    // Inline code → keep content
    .replace(/`([^`]+)`/g, '$1')
    // ATX headings → keep text
    .replace(/^#{1,6}\s+(.*)/gm, '$1')
    // Setext headings (=== or ---) → remove underline
    .replace(/^[=\-]{2,}\s*$/gm, '')
    // Bold / italic (**, __, *, _)
    .replace(/(\*\*|__)(.*?)\1/gs, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    // Strikethrough
    .replace(/~~(.*?)~~/gs, '$1')
    // Links [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Images ![alt](url) → alt
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Blockquotes
    .replace(/^>\s?/gm, '')
    // Horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Unordered list markers
    .replace(/^[ \t]*[-*+]\s+/gm, '')
    // Ordered list markers
    .replace(/^[ \t]*\d+\.\s+/gm, '')
    // Collapse 3+ blank lines to 2
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function exportToText(note: ExportableNote): string {
  return stripMarkdown(note.content);
}

export function exportToJson(notes: ExportableNote[]): string {
  return JSON.stringify(
    notes.map((n) => ({ metadata: n.metadata, content: n.content })),
    null,
    2,
  );
}

export async function exportToZip(notes: ExportableNote[]): Promise<Buffer> {
  const zip = new JSZip();
  const usedNames = new Set<string>();

  for (const note of notes) {
    const base = basename(note.fileName);
    let entryName = base;
    let counter = 2;
    while (usedNames.has(entryName)) {
      const dot = base.lastIndexOf('.');
      entryName = dot >= 0
        ? `${base.slice(0, dot)} (${counter})${base.slice(dot)}`
        : `${base} (${counter})`;
      counter++;
    }
    usedNames.add(entryName);
    zip.file(entryName, note.rawMarkdown);
  }

  return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>;
}

export function makeExportFileName(
  format: 'markdown' | 'json' | 'text' | 'zip',
  noteTitle?: string,
): string {
  const ts = Date.now();
  if (format === 'markdown' || format === 'text') {
    const ext = format === 'text' ? 'txt' : 'md';
    const slug = noteTitle
      ? (noteTitle
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40) || 'untitled')
      : 'export';
    return `${slug}-${ts}.${ext}`;
  }
  const ext = format === 'json' ? 'json' : 'zip';
  return `export-${ts}.${ext}`;
}

export function writeExportFile(
  content: string | Buffer,
  fileName: string,
  exportsDir: string,
): string {
  mkdirSync(exportsDir, { recursive: true });
  const filePath = join(exportsDir, fileName);
  writeFileSync(filePath, content);
  return filePath;
}
