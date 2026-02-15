import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
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

      const note = deps.markdown.read(row.filePath);
      if (!note) {
        throw new Error(`Note file missing for: ${params.id}`);
      }

      const meta = note.metadata;
      const text = [
        `# ${meta.title}`,
        `**Type:** ${meta.type} | **Category:** ${meta.category}`,
        `**Tags:** [${meta.tags.join(', ')}]`,
        `**Created:** ${meta.created} | **Updated:** ${meta.updated}`,
        meta.sourceUrl ? `**Source:** ${meta.sourceUrl}` : '',
        meta.gist ? `**Summary:** ${meta.gist}` : '',
        `---`,
        note.content,
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
