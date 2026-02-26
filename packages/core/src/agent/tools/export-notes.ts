import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Type, StringEnum, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import matter from 'gray-matter';
import type { ContentType } from '@echos/shared';
import type { SqliteStorage, ListNotesOptions, NoteRow } from '../../storage/sqlite.js';
import type { MarkdownStorage } from '../../storage/markdown.js';
import {
  exportToMarkdown,
  exportToText,
  exportToJson,
  exportToZip,
  makeExportFileName,
  writeExportFile,
  type ExportableNote,
  type ExportFileResult,
} from '../../export/index.js';

export interface ExportNotesToolDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
  exportsDir: string;
}

const schema = Type.Object({
  format: StringEnum(['markdown', 'json', 'text', 'zip'], {
    description:
      'Export format. "text" strips markdown syntax (good for plain prose). "markdown" preserves formatting. "json" wraps content with metadata. "zip" bundles multiple notes. Single content/note exports return inline; multi-note or json/zip write a file.',
  }),
  content: Type.Optional(
    Type.String({
      description:
        'Arbitrary text to export directly — use this for analysis results, agent responses, conversation excerpts, or any content not stored as a note. When provided, id and filter are ignored.',
    }),
  ),
  title: Type.Optional(
    Type.String({
      description: 'Title / filename hint when exporting via content. Defaults to "export".',
    }),
  ),
  id: Type.Optional(Type.String({ description: 'Single note ID (UUID). Omit to export by filter.' })),
  filter: Type.Optional(
    Type.Object({
      type: Type.Optional(
        StringEnum(['note', 'journal', 'article', 'youtube', 'tweet', 'reminder', 'conversation'], {
          description: 'Filter by content type',
        }),
      ),
      tags: Type.Optional(Type.Array(Type.String(), { description: 'Filter by tags (all must match)' })),
      category: Type.Optional(Type.String({ description: 'Filter by category' })),
      dateFrom: Type.Optional(Type.String({ description: 'ISO 8601 start date' })),
      dateTo: Type.Optional(Type.String({ description: 'ISO 8601 end date' })),
      limit: Type.Optional(
        Type.Number({
          description: 'Max notes to export (default 50, max 100)',
          default: 50,
          minimum: 1,
          maximum: 100,
        }),
      ),
    }),
  ),
});

type Params = Static<typeof schema>;

/** Reconstruct full markdown (YAML frontmatter + body) from a SQLite row. */
function rowToRawMarkdown(row: NoteRow): string {
  const frontmatter: Record<string, unknown> = {
    id: row.id,
    type: row.type,
    title: row.title,
    created: row.created,
    updated: row.updated,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
    links: row.links ? row.links.split(',').filter(Boolean) : [],
    category: row.category,
  };
  if (row.sourceUrl != null) frontmatter['source_url'] = row.sourceUrl;
  if (row.author != null) frontmatter['author'] = row.author;
  if (row.gist != null) frontmatter['gist'] = row.gist;
  if (row.status != null) frontmatter['status'] = row.status;
  return matter.stringify(row.content, frontmatter);
}

/** Build an ExportableNote from a SQLite row, reading the file from disk when available. */
function buildExportableNote(row: NoteRow, markdown: MarkdownStorage): ExportableNote {
  let rawMarkdown: string;
  let content = row.content;

  const noteFile = markdown.read(row.filePath);
  if (noteFile) {
    try {
      rawMarkdown = readFileSync(row.filePath, 'utf8');
      content = noteFile.content;
    } catch {
      // File listed in SQLite but unreadable — reconstruct from row
      rawMarkdown = rowToRawMarkdown(row);
      content = row.content;
    }
  } else {
    rawMarkdown = rowToRawMarkdown(row);
  }

  const metadata: Record<string, unknown> = {
    id: row.id,
    type: row.type,
    title: row.title,
    created: row.created,
    updated: row.updated,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
    links: row.links ? row.links.split(',').filter(Boolean) : [],
    category: row.category,
  };
  if (row.sourceUrl != null) metadata['sourceUrl'] = row.sourceUrl;
  if (row.author != null) metadata['author'] = row.author;
  if (row.gist != null) metadata['gist'] = row.gist;
  if (row.status != null) metadata['status'] = row.status;

  const fileSlug = basename(row.filePath);
  return {
    id: row.id,
    title: row.title,
    content,
    rawMarkdown,
    fileName: fileSlug || `${row.id}.md`,
    metadata,
  };
}

export function createExportNotesTool(deps: ExportNotesToolDeps): AgentTool<typeof schema> {
  const { sqlite, markdown, exportsDir } = deps;

  return {
    name: 'export_notes',
    label: 'Export',
    description:
      'Export content as a downloadable file. Use the "content" parameter to export any arbitrary text (analysis results, agent responses, conversation excerpts) without needing a stored note. Use "id" or "filter" to export stored notes. Returns an export_file result that the interface delivers to the user.',
    parameters: schema,
    execute: async (_toolCallId, params: Params) => {
      // ── Direct content export (arbitrary text, no note lookup) ────────────
      if (params.content !== undefined) {
        const title = params.title ?? 'export';
        const format = params.format as 'markdown' | 'json' | 'text' | 'zip';
        const note: ExportableNote = {
          id: 'direct',
          title,
          content: params.content,
          rawMarkdown: params.content,
          fileName: makeExportFileName(format === 'zip' ? 'markdown' : format, title).replace(
            /\.zip$/,
            '.md',
          ),
          metadata: { title, created: new Date().toISOString() },
        };

        let result: ExportFileResult;

        if (format === 'text') {
          result = {
            type: 'export_file',
            filePath: '',
            fileName: makeExportFileName('text', title),
            format: 'text',
            noteCount: 1,
            inline: exportToText(note),
          };
        } else if (format === 'json') {
          const jsonStr = exportToJson([note]);
          const fileName = makeExportFileName('json', title);
          const filePath = writeExportFile(jsonStr, fileName, exportsDir);
          result = { type: 'export_file', filePath, fileName, format: 'json', noteCount: 1 };
        } else {
          // markdown or zip — return inline as markdown
          result = {
            type: 'export_file',
            filePath: '',
            fileName: makeExportFileName('markdown', title),
            format: 'markdown',
            noteCount: 1,
            inline: params.content,
          };
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          details: { noteCount: 1, format: result.format, summary: `Exported "${title}" as ${result.format}.` },
        };
      }

      // ── Note lookup from storage ───────────────────────────────────────────
      let rows: NoteRow[];

      if (params.id) {
        const row = sqlite.getNote(params.id);
        if (!row) {
          throw new Error(`Note not found: ${params.id}`);
        }
        rows = [row];
      } else {
        const opts: ListNotesOptions = {
          limit: Math.min(params.filter?.limit ?? 50, 100),
        };
        if (params.filter?.type) opts.type = params.filter.type as ContentType;
        if (params.filter?.category) opts.category = params.filter.category;
        if (params.filter?.dateFrom) opts.dateFrom = params.filter.dateFrom;
        if (params.filter?.dateTo) opts.dateTo = params.filter.dateTo;
        // tags filter: listNotes filters by tag membership
        rows = sqlite.listNotes(opts);
        // Apply tags filter in memory (listNotes may not support multi-tag AND)
        if (params.filter?.tags && params.filter.tags.length > 0) {
          const requiredTags = params.filter.tags.map((t) => t.toLowerCase());
          rows = rows.filter((row) => {
            const rowTags = row.tags
              ? row.tags.split(',').filter(Boolean).map((t) => t.toLowerCase())
              : [];
            return requiredTags.every((t) => rowTags.includes(t));
          });
        }
      }

      if (rows.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No notes found matching the criteria.' }],
          details: { noteCount: 0 },
        };
      }

      const notes = rows.map((row) => buildExportableNote(row, markdown));

      // Determine effective format
      let format = params.format as 'markdown' | 'json' | 'text' | 'zip';
      if (notes.length > 1 && (format === 'markdown' || format === 'text')) {
        format = 'zip';
      }

      let result: ExportFileResult;

      if (format === 'markdown') {
        // Single note — return inline
        const note = notes[0]!;
        const inline = exportToMarkdown(note);
        result = {
          type: 'export_file',
          filePath: '',
          fileName: makeExportFileName('markdown', note.title),
          format: 'markdown',
          noteCount: 1,
          inline,
        };
      } else if (format === 'text') {
        // Single note — return inline
        const note = notes[0]!;
        const inline = exportToText(note);
        result = {
          type: 'export_file',
          filePath: '',
          fileName: makeExportFileName('text', note.title),
          format: 'text',
          noteCount: 1,
          inline,
        };
      } else if (format === 'json') {
        const jsonStr = exportToJson(notes);
        const fileName = makeExportFileName('json');
        const filePath = writeExportFile(jsonStr, fileName, exportsDir);
        result = {
          type: 'export_file',
          filePath,
          fileName,
          format: 'json',
          noteCount: notes.length,
        };
      } else {
        // zip
        const buf = await exportToZip(notes);
        const fileName = makeExportFileName('zip');
        const filePath = writeExportFile(buf, fileName, exportsDir);
        result = {
          type: 'export_file',
          filePath,
          fileName,
          format: 'zip',
          noteCount: notes.length,
        };
      }

      const summary =
        result.inline !== undefined
          ? `Exported note "${notes[0]!.title}" as ${result.format}. Delivering inline.`
          : `Exported ${result.noteCount} note(s) as ${result.format}. File: ${result.fileName}`;

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: { noteCount: result.noteCount, format: result.format, summary },
      };
    },
  };
}
