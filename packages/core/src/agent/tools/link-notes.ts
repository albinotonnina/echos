import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { SqliteStorage } from '../../storage/sqlite.js';
import type { MarkdownStorage } from '../../storage/markdown.js';

export interface LinkNotesToolDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
}

const schema = Type.Object({
  source_id: Type.String({ description: 'ID of the first note' }),
  target_id: Type.String({ description: 'ID of the second note' }),
});

type Params = Static<typeof schema>;

export function linkNotesTool(deps: LinkNotesToolDeps): AgentTool<typeof schema> {
  return {
    name: 'link_notes',
    label: 'Link Notes',
    description: 'Create a bidirectional link between two notes.',
    parameters: schema,
    execute: async (_toolCallId, params: Params) => {
      const sourceRow = deps.sqlite.getNote(params.source_id);
      if (!sourceRow) {
        throw new Error(`Source note not found: ${params.source_id}`);
      }

      const targetRow = deps.sqlite.getNote(params.target_id);
      if (!targetRow) {
        throw new Error(`Target note not found: ${params.target_id}`);
      }

      // Add target to source's links
      const sourceNote = deps.markdown.read(sourceRow.filePath);
      if (sourceNote && !sourceNote.metadata.links.includes(params.target_id)) {
        const updatedLinks = [...sourceNote.metadata.links, params.target_id];
        deps.markdown.update(sourceRow.filePath, { links: updatedLinks });
        deps.sqlite.upsertNote(
          { ...sourceNote.metadata, links: updatedLinks },
          sourceNote.content,
          sourceRow.filePath,
        );
      }

      // Add source to target's links
      const targetNote = deps.markdown.read(targetRow.filePath);
      if (targetNote && !targetNote.metadata.links.includes(params.source_id)) {
        const updatedLinks = [...targetNote.metadata.links, params.source_id];
        deps.markdown.update(targetRow.filePath, { links: updatedLinks });
        deps.sqlite.upsertNote(
          { ...targetNote.metadata, links: updatedLinks },
          targetNote.content,
          targetRow.filePath,
        );
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Linked "${sourceRow.title}" ↔ "${targetRow.title}"`,
          },
        ],
        details: {
          sourceId: params.source_id,
          targetId: params.target_id,
        },
      };
    },
  };
}
