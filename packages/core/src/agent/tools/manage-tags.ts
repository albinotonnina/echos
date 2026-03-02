import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { SqliteStorage } from '../../storage/sqlite.js';
import type { MarkdownStorage } from '../../storage/markdown.js';
import { ValidationError } from '@echos/shared';

export interface ManageTagsToolDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
}

const schema = Type.Object({
  action: Type.Union(
    [Type.Literal('list'), Type.Literal('rename'), Type.Literal('merge')],
    {
      description:
        'list: show all tags with counts | rename: rename a tag across all notes | merge: consolidate multiple tags into one',
    },
  ),
  from: Type.Optional(Type.String({ description: 'Tag to rename (rename action)' })),
  to: Type.Optional(Type.String({ description: 'New tag name (rename action)' })),
  tags: Type.Optional(
    Type.Array(Type.String(), { description: 'Tags to consolidate (merge action)' }),
  ),
  into: Type.Optional(Type.String({ description: 'Target tag to merge into (merge action)' })),
  limit: Type.Optional(
    Type.Number({
      description: 'Max tags to return for list action (default 100, min 1, max 500)',
      minimum: 1,
      maximum: 500,
    }),
  ),
});

type Params = Static<typeof schema>;

function validateTagValue(value: string, fieldName: string): void {
  if (value.includes(',')) {
    throw new ValidationError(`"${fieldName}" must not contain commas`);
  }
}

/** Paginate through all notes that carry a given tag, returning id+filePath pairs. */
function getAllNotesWithTag(
  sqlite: SqliteStorage,
  tag: string,
): Array<{ id: string; filePath: string }> {
  const pageSize = 1000;
  const results: Array<{ id: string; filePath: string }> = [];
  let offset = 0;
  while (true) {
    const page = sqlite.listNotes({ tags: [tag], limit: pageSize, offset });
    for (const note of page) {
      results.push({ id: note.id, filePath: note.filePath });
    }
    if (page.length < pageSize) break;
    offset += page.length;
  }
  return results;
}

function syncMarkdown(
  deps: ManageTagsToolDeps,
  noteId: string,
  filePath: string,
): void {
  try {
    const updated = deps.sqlite.getNote(noteId);
    if (!updated) return;
    const newTags = updated.tags ? updated.tags.split(',').filter(Boolean) : [];
    // Do not pass `updated` — markdown.update() always writes a fresh timestamp
    deps.markdown.update(filePath, { tags: newTags });
  } catch {
    // Non-fatal: file may be missing or moved
  }
}

export function createManageTagsTool(deps: ManageTagsToolDeps): AgentTool<typeof schema> {
  return {
    name: 'manage_tags',
    label: 'Manage Tags',
    description:
      'Manage the tag vocabulary across all notes. Use action="list" to see all tags with usage counts. Use action="rename" to rename a tag across all notes (e.g., "js" → "javascript"). Use action="merge" to consolidate multiple tags into one (e.g., merge ["react", "reactjs"] into "react").',
    parameters: schema,
    execute: async (_toolCallId, params: Params) => {
      if (params.action === 'list') {
        const limit = Math.min(Math.max(1, params.limit ?? 100), 500);
        const tags = deps.sqlite.getTopTagsWithCounts(limit);

        if (tags.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No tags found in your knowledge base.' }],
            details: { total: 0, tags: [] },
          };
        }

        const lines = tags.map(({ tag, count }) => `- **${tag}** (${count} note${count === 1 ? '' : 's'})`);
        const truncated = tags.length === limit;
        const summary = truncated
          ? `Top ${tags.length} tag${tags.length === 1 ? '' : 's'} in your knowledge base (there may be more — use a higher limit to see up to 500):`
          : `${tags.length} tag${tags.length === 1 ? '' : 's'} in your knowledge base:`;
        return {
          content: [
            {
              type: 'text' as const,
              text: `${summary}\n\n${lines.join('\n')}`,
            },
          ],
          details: { total: tags.length, limit, truncated, tags },
        };
      }

      if (params.action === 'rename') {
        if (!params.from || !params.to) {
          throw new ValidationError('rename action requires both "from" and "to" parameters');
        }
        const from = params.from.trim();
        const to = params.to.trim();
        if (!from || !to) {
          throw new ValidationError('"from" and "to" must be non-empty strings');
        }
        validateTagValue(from, 'from');
        validateTagValue(to, 'to');
        if (from === to) {
          return {
            content: [
              { type: 'text' as const, text: `Tag "${from}" is already named "${to}". No changes made.` },
            ],
            details: { affected: 0 },
          };
        }

        // Paginate through ALL affected notes before rename (for distinct count + markdown sync)
        const affected = getAllNotesWithTag(deps.sqlite, from);
        deps.sqlite.renameTag(from, to);
        for (const note of affected) {
          syncMarkdown(deps, note.id, note.filePath);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text:
                affected.length > 0
                  ? `Renamed tag "${from}" to "${to}" across ${affected.length} note${affected.length === 1 ? '' : 's'}.`
                  : `Tag "${from}" was not found in any notes. No changes made.`,
            },
          ],
          details: { from, to, affected: affected.length },
        };
      }

      if (params.action === 'merge') {
        if (!params.tags || params.tags.length === 0) {
          throw new ValidationError('merge action requires a "tags" array of tags to consolidate');
        }
        if (!params.into) {
          throw new ValidationError('merge action requires an "into" parameter specifying the target tag');
        }
        const into = params.into.trim();
        if (!into) {
          throw new ValidationError('"into" must be a non-empty string');
        }
        validateTagValue(into, 'into');
        const tags = params.tags.map((t) => t.trim()).filter(Boolean);
        for (const t of tags) {
          validateTagValue(t, 'tags');
        }

        // sourceTags excludes the into tag (those notes don't need a rename)
        const sourceTags = tags.filter((t) => t !== into);
        if (sourceTags.length === 0) {
          return {
            content: [
              { type: 'text' as const, text: `No source tags differ from "${into}". No changes made.` },
            ],
            details: { tags, into, affected: 0 },
          };
        }

        // Paginate through ALL affected notes before merge (distinct count + markdown sync)
        const affectedMap = new Map<string, { id: string; filePath: string }>();
        for (const sourceTag of sourceTags) {
          for (const note of getAllNotesWithTag(deps.sqlite, sourceTag)) {
            affectedMap.set(note.id, note);
          }
        }

        deps.sqlite.mergeTags(tags, into);
        for (const { id, filePath } of affectedMap.values()) {
          syncMarkdown(deps, id, filePath);
        }

        const affectedCount = affectedMap.size;
        const sourceList = sourceTags.join('", "');
        return {
          content: [
            {
              type: 'text' as const,
              text:
                affectedCount > 0
                  ? `Merged tags "${sourceList}" into "${into}" across ${affectedCount} note${affectedCount === 1 ? '' : 's'}.`
                  : `None of the source tags were found in any notes. No changes made.`,
            },
          ],
          details: { tags, into, affected: affectedCount },
        };
      }

      throw new ValidationError(`Unknown action: ${String(params.action)}`);
    },
  };
}
