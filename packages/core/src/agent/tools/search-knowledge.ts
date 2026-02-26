import { Type, StringEnum, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { SearchService } from '../../storage/search.js';
import type { ContentType, SearchOptions } from '@echos/shared';

export interface SearchKnowledgeToolDeps {
  search: SearchService;
  generateEmbedding: (text: string) => Promise<number[]>;
}

const schema = Type.Object({
  query: Type.String({ description: 'Search query', minLength: 1 }),
  mode: Type.Optional(
    StringEnum(['hybrid', 'keyword', 'semantic'], {
      description: 'Search mode. Default: hybrid',
      default: 'hybrid',
    }),
  ),
  type: Type.Optional(
    StringEnum(['note', 'journal', 'article', 'youtube', 'reminder'], {
      description: 'Filter by content type',
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: 'Max results to return', default: 10, minimum: 1, maximum: 50 }),
  ),
});

type Params = Static<typeof schema>;

export function searchKnowledgeTool(deps: SearchKnowledgeToolDeps): AgentTool<typeof schema> {
  return {
    name: 'search_knowledge',
    label: 'Search Knowledge',
    description:
      'Search the knowledge base when the user asks about their saved knowledge items (e.g. notes, journals, articles, reminders, YouTube content). Uses hybrid search (keyword + semantic) by default.',
    parameters: schema,
    execute: async (_toolCallId, params: Params) => {
      const mode = params.mode ?? 'hybrid';
      const limit = params.limit ?? 10;

      const opts: SearchOptions = { query: params.query, limit };
      if (params.type) opts.type = params.type as ContentType;

      let results;

      if (mode === 'keyword') {
        results = deps.search.keyword(opts);
      } else {
        const vector = await deps.generateEmbedding(params.query);
        if (mode === 'semantic') {
          results = await deps.search.semantic({ ...opts, vector });
        } else {
          results = await deps.search.hybrid({ ...opts, vector });
        }
      }

      if (results.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No results found.' }],
          details: { resultCount: 0 },
        };
      }

      const formatted = results
        .map((r, i) => {
          const meta = r.note.metadata;
          const snippet = r.note.content.slice(0, 200).replace(/\n/g, ' ');
          return `${i + 1}. **${meta.title}** (${meta.type}, id: ${meta.id})\n   Tags: [${meta.tags.join(', ')}] | Score: ${r.score.toFixed(3)}\n   ${snippet}${r.note.content.length > 200 ? '...' : ''}`;
        })
        .join('\n\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `Found ${results.length} result(s) for "${params.query}":\n\n${formatted}`,
          },
        ],
        details: { resultCount: results.length, mode },
      };
    },
  };
}
