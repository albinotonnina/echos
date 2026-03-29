import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { SearchService } from '../../storage/search.js';
import type { SearchOptions } from '@echos/shared';

export interface SearchConversationsToolDeps {
  search: SearchService;
  generateEmbedding: (text: string) => Promise<number[]>;
}

const schema = Type.Object({
  query: Type.String({ description: 'Search query for finding past conversations', minLength: 1 }),
  dateFrom: Type.Optional(
    Type.String({ description: 'Start date filter (ISO 8601, e.g. "2025-01-01")' }),
  ),
  dateTo: Type.Optional(
    Type.String({ description: 'End date filter (ISO 8601, e.g. "2025-12-31")' }),
  ),
  limit: Type.Optional(
    Type.Number({ description: 'Max results to return', default: 5, minimum: 1, maximum: 20 }),
  ),
});

type Params = Static<typeof schema>;

export function searchConversationsTool(
  deps: SearchConversationsToolDeps,
): AgentTool<typeof schema> {
  return {
    name: 'search_conversations',
    label: 'Search Conversations',
    description:
      'Search through saved conversations. Use when the user asks "did we discuss X?", "what did I say about Y last week?", or references past conversations. Searches only conversation-type notes using hybrid search.',
    parameters: schema,
    execute: async (_toolCallId: string, params: Params) => {
      const limit = params.limit ?? 5;

      const opts: SearchOptions = {
        query: params.query,
        type: 'conversation',
        limit,
      };
      if (params.dateFrom) opts.dateFrom = params.dateFrom;
      if (params.dateTo) opts.dateTo = params.dateTo;

      // Use hybrid search for best results
      const vector = await deps.generateEmbedding(params.query);
      let results = await deps.search.hybrid({ ...opts, vector });

      // Apply date filtering on results (since hybrid search may not filter by date)
      if (params.dateFrom || params.dateTo) {
        results = results.filter((r) => {
          const created = r.note.metadata.created;
          if (params.dateFrom && created < params.dateFrom) return false;
          if (params.dateTo && created > params.dateTo) return false;
          return true;
        });
      }

      if (results.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No saved conversations found matching your query.',
            },
          ],
          details: { resultCount: 0 },
        };
      }

      const formatted = results
        .map((r, i) => {
          const meta = r.note.metadata;
          const date = meta.created.slice(0, 10);
          const excerpt = r.note.content.slice(0, 300).replace(/\n/g, ' ');
          const tags = meta.tags.length > 0 ? ` | Tags: [${meta.tags.join(', ')}]` : '';
          return `${i + 1}. **${meta.title}** (${date}, id: ${meta.id})${tags}\n   ${excerpt}${r.note.content.length > 300 ? '...' : ''}`;
        })
        .join('\n\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `Found ${results.length} conversation(s) matching "${params.query}":\n\n${formatted}`,
          },
        ],
        details: { resultCount: results.length },
      };
    },
  };
}
