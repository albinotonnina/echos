import { Type, StringEnum, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { NotFoundError, type ContentType } from '@echos/shared';
import type { SqliteStorage } from '../../storage/sqlite.js';
import type { VectorStorage } from '../../storage/vectordb.js';

export interface FindSimilarToolDeps {
  sqlite: SqliteStorage;
  vectorDb: VectorStorage;
  generateEmbedding: (text: string) => Promise<number[]>;
}

const schema = Type.Object({
  noteId: Type.String({ description: 'The ID of the reference note to find similar notes for' }),
  limit: Type.Optional(
    Type.Number({
      description: 'Maximum number of similar notes to return (default: 5)',
      default: 5,
      minimum: 1,
      maximum: 50,
    }),
  ),
  excludeType: Type.Optional(
    Type.Array(
      StringEnum(['note', 'journal', 'article', 'youtube', 'tweet', 'reminder', 'conversation', 'image'], {
        description: 'Content type to exclude',
      }),
      { description: 'Content types to exclude from results (e.g. exclude reminders)' },
    ),
  ),
});

type Params = Static<typeof schema>;

export function findSimilarTool(deps: FindSimilarToolDeps): AgentTool<typeof schema> {
  return {
    name: 'find_similar',
    label: 'Find Similar Notes',
    description:
      'Find notes that are semantically similar to a given note. Takes a note ID and returns the most similar notes ranked by embedding distance. Useful for discovering related content and connections.',
    parameters: schema,
    execute: async (_toolCallId: string, params: Params) => {
      const limit = params.limit ?? 5;
      const excludeTypes = new Set<string>(params.excludeType ?? []);

      // Get the reference note
      const row = deps.sqlite.getNote(params.noteId);
      if (!row) {
        throw new NotFoundError('note', params.noteId);
      }

      // Generate embedding from the note's content
      const embeddingText = `${row.title}\n\n${row.content}`;
      const vector = await deps.generateEmbedding(embeddingText);

      // Find nearest neighbors, excluding the reference note itself
      // Fetch extra to account for type filtering
      const fetchLimit = excludeTypes.size > 0 ? limit + 20 : limit;
      const similar = await deps.vectorDb.findByVector(vector, fetchLimit, [params.noteId]);

      // Apply type filtering
      const filtered = excludeTypes.size > 0
        ? similar.filter((r) => !excludeTypes.has(r.type as ContentType))
        : similar;
      const results = filtered.slice(0, limit);

      if (results.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No similar notes found for "${row.title}".`,
            },
          ],
          details: { resultCount: 0, referenceNoteId: params.noteId },
        };
      }

      // Get reference note tags for comparison
      const refTags = new Set(row.tags ? row.tags.split(',').filter(Boolean) : []);

      const formatted = results
        .map((r, i) => {
          // Look up full metadata from SQLite for tag/category comparison
          const noteRow = deps.sqlite.getNote(r.id);
          const noteTags = noteRow?.tags ? noteRow.tags.split(',').filter(Boolean) : [];
          const noteCategory = noteRow?.category ?? '';
          const refCategory = row.category ?? '';

          const sharedTags = noteTags.filter((t) => refTags.has(t));
          const sharedInfo: string[] = [];
          if (sharedTags.length > 0) {
            sharedInfo.push(`shared tags: [${sharedTags.join(', ')}]`);
          }
          if (noteCategory && noteCategory === refCategory) {
            sharedInfo.push(`same category: ${noteCategory}`);
          }

          const snippet = r.text.slice(0, 200).replace(/\n/g, ' ');
          return [
            `${i + 1}. **${r.title}** (${r.type}, id: ${r.id})`,
            `   Similarity: ${r.similarity}% | Tags: [${noteTags.join(', ')}]`,
            sharedInfo.length > 0 ? `   ${sharedInfo.join(' | ')}` : '',
            `   ${snippet}${r.text.length > 200 ? '...' : ''}`,
          ]
            .filter(Boolean)
            .join('\n');
        })
        .join('\n\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `Found ${results.length} note(s) similar to "${row.title}":\n\n${formatted}`,
          },
        ],
        details: {
          resultCount: results.length,
          referenceNoteId: params.noteId,
          referenceTitle: row.title,
        },
      };
    },
  };
}
