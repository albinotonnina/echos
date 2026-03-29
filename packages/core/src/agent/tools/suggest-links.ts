import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { SqliteStorage } from '../../storage/sqlite.js';
import type { VectorStorage } from '../../storage/vectordb.js';
import { suggestLinks } from '../../graph/auto-linker.js';

export interface SuggestLinksToolDeps {
  sqlite: SqliteStorage;
  vectorDb: VectorStorage;
  generateEmbedding: (text: string) => Promise<number[]>;
}

const schema = Type.Object({
  noteId: Type.String({ description: 'ID of the note to find link suggestions for' }),
  limit: Type.Optional(
    Type.Number({
      description: 'Maximum number of suggestions to return (default 5, max 20)',
      minimum: 1,
      maximum: 20,
      default: 5,
    }),
  ),
});

type Params = Static<typeof schema>;

export function createSuggestLinksTool(deps: SuggestLinksToolDeps): AgentTool<typeof schema> {
  return {
    name: 'suggest_links',
    label: 'Suggest Links',
    description:
      'Find semantically similar notes that could be linked to a given note. Returns suggestions with similarity scores and a brief reason. Use link_notes to accept any of the suggestions.',
    parameters: schema,
    execute: async (_toolCallId: string, params: Params) => {
      const note = deps.sqlite.getNote(params.noteId);
      if (!note) {
        return {
          content: [{ type: 'text' as const, text: `Note not found: ${params.noteId}` }],
          details: { suggestions: [] },
        };
      }

      const suggestions = await suggestLinks(
        params.noteId,
        deps.sqlite,
        deps.vectorDb,
        deps.generateEmbedding,
        params.limit ?? 5,
      );

      if (suggestions.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No link suggestions found for "${note.title}". No semantically similar unlinked notes were found above the similarity threshold.`,
            },
          ],
          details: { suggestions: [] },
        };
      }

      const lines: string[] = [
        `## Link Suggestions for "${note.title}"\n`,
        ...suggestions.map(
          (s, i) =>
            `${i + 1}. **${s.targetTitle}** (id: \`${s.targetId}\`)\n   Similarity: ${(s.similarity * 100).toFixed(1)}% — ${s.reason}`,
        ),
        '',
        'Use `link_notes` with `source_id` and `target_id` to create any of these links.',
      ];

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        details: { suggestions },
      };
    },
  };
}
