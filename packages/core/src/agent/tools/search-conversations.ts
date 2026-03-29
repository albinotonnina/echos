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

const EXCERPT_LENGTH = 300;

/**
 * Extract an excerpt around the first query term match, or fall back to the start of the content.
 */
function extractExcerpt(content: string, queryTerms: string[]): string {
  const flat = content.replace(/\n/g, ' ');
  const lower = flat.toLowerCase();

  // Find the earliest matching query term position
  let bestPos = -1;
  for (const term of queryTerms) {
    const pos = lower.indexOf(term);
    if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
      bestPos = pos;
    }
  }

  if (bestPos === -1 || bestPos <= EXCERPT_LENGTH / 2) {
    // No match or match is near the start — use the beginning
    const slice = flat.slice(0, EXCERPT_LENGTH);
    return flat.length > EXCERPT_LENGTH ? `${slice}...` : slice;
  }

  // Center the excerpt around the match
  const start = Math.max(0, bestPos - Math.floor(EXCERPT_LENGTH / 4));
  const end = Math.min(flat.length, start + EXCERPT_LENGTH);
  const slice = flat.slice(start, end);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < flat.length ? '...' : '';
  return `${prefix}${slice}${suffix}`;
}

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
      const hasDateFilter = !!(params.dateFrom || params.dateTo);

      // Normalize date filters to date-only strings for inclusive comparison
      const fromDate = params.dateFrom ? params.dateFrom.slice(0, 10) : undefined;
      const toDate = params.dateTo ? params.dateTo.slice(0, 10) : undefined;

      const opts: SearchOptions = {
        query: params.query,
        type: 'conversation',
        // Fetch more candidates when date filtering to avoid under-returning
        limit: hasDateFilter ? limit * 4 : limit,
      };
      if (params.dateFrom) opts.dateFrom = params.dateFrom;
      if (params.dateTo) opts.dateTo = params.dateTo;

      // Use hybrid search for best results
      const vector = await deps.generateEmbedding(params.query);
      let results = await deps.search.hybrid({ ...opts, vector });

      // Apply date filtering using date-only comparison (inclusive range)
      if (hasDateFilter) {
        results = results.filter((r) => {
          const createdDate = r.note.metadata.created.slice(0, 10);
          if (fromDate && createdDate < fromDate) return false;
          if (toDate && createdDate > toDate) return false;
          return true;
        });
        results = results.slice(0, limit);
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

      // Build query terms for excerpt extraction
      const queryTerms = params.query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 2);

      const formatted = results
        .map((r, i) => {
          const meta = r.note.metadata;
          const date = meta.created.slice(0, 10);
          const excerpt = extractExcerpt(r.note.content, queryTerms);
          const tags = meta.tags.length > 0 ? ` | Tags: [${meta.tags.join(', ')}]` : '';
          return `${i + 1}. **${meta.title}** (${date}, id: ${meta.id})${tags}\n   ${excerpt}`;
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
