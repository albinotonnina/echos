import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { NoteMetadata } from '@echos/shared';
import type { SqliteStorage } from '../../storage/sqlite.js';
import type { MarkdownStorage } from '../../storage/markdown.js';

export interface GetNoteToolDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
}

const schema = Type.Object({
  id: Type.String({ description: 'Note ID (UUID)' }),
});

type Params = Static<typeof schema>;

export function getNoteTool(deps: GetNoteToolDeps): AgentTool<typeof schema> {
  return {
    name: 'get_note',
    label: 'Get Note',
    description: 'Retrieve a specific note by its ID. Returns the full content and metadata.',
    parameters: schema,
    execute: async (_toolCallId, params: Params) => {
      const row = deps.sqlite.getNote(params.id);
      if (!row) {
        throw new Error(`Note not found: ${params.id}`);
      }

      const noteFile = deps.markdown.read(row.filePath);
      let meta: NoteMetadata;
      let content: string;
      if (noteFile) {
        meta = noteFile.metadata;
        content = noteFile.content;
      } else {
        // File missing from disk - reconstruct from SQLite content
        meta = {
          id: row.id,
          type: row.type,
          title: row.title,
          created: row.created,
          updated: row.updated,
          tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
          links: row.links ? row.links.split(',').filter(Boolean) : [],
          category: row.category,
        };
        if (row.sourceUrl != null) meta.sourceUrl = row.sourceUrl;
        if (row.author != null) meta.author = row.author;
        if (row.gist != null) meta.gist = row.gist;
        content = row.content;
      }

      const text = [
        `# ${meta.title}`,
        `**Type:** ${meta.type} | **Category:** ${meta.category}`,
        `**Tags:** [${meta.tags.join(', ')}]`,
        `**Created:** ${meta.created} | **Updated:** ${meta.updated}`,
        meta.sourceUrl ? `**Source:** ${meta.sourceUrl}` : '',
        meta.gist ? `**Summary:** ${meta.gist}` : '',
        `---`,
        content,
      ]
        .filter(Boolean)
        .join('\n');

      return {
        content: [{ type: 'text' as const, text }],
        details: { id: params.id, type: meta.type },
      };
    },
  };
}
