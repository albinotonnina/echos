import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { PluginContext } from '@echos/core';
import { resurfaceNotes, formatSurfacedNote } from '../resurfacer.js';

const schema = Type.Object({
  mode: Type.Optional(
    Type.Union(
      [Type.Literal('forgotten'), Type.Literal('on_this_day'), Type.Literal('mix'), Type.Literal('random')],
      {
        description:
          'Resurfacing strategy: "forgotten" (oldest un-seen notes), "on_this_day" (same calendar date in prior years), "mix" (blend of both), "random" (purely random notes). Defaults to "mix".',
      },
    ),
  ),
  limit: Type.Optional(
    Type.Number({
      description: 'Number of notes to resurface (default: 3, max: 10)',
      minimum: 1,
      maximum: 10,
    }),
  ),
});

type Params = Static<typeof schema>;

export function createGetResurfacedTool(context: PluginContext): AgentTool<typeof schema> {
  return {
    name: 'get_resurfaced',
    label: 'Resurface Notes',
    description:
      'Retrieves notes from your knowledge base that you have not seen in a while, or that were saved on this same calendar date in a prior year. ' +
      'ALWAYS call this tool (instead of list_notes or search_knowledge) when the user asks to be surprised, wants to rediscover old notes, or uses phrases like: ' +
      '"surprise me", "what did I save before?", "on this day", "rediscover something", "show me something old", "show me something I\'ve forgotten", ' +
      '"random note", "what have I not read recently?", "resurface something", or any request to revisit past knowledge. ' +
      'Default mode is "mix" (forgotten + on-this-day blend). Use mode="on_this_day" when the user specifically asks about past dates. Use mode="random" for pure discovery. Use mode="forgotten" when the user asks what they haven\'t revisited. ' +
      'After returning results, always offer to go deeper: "Want me to pull up the full note, search for related ideas, or mark any of these as read?" ' +
      'Updates each note\'s last-surfaced timestamp so the same note is not repeated within 7 days.',
    parameters: schema,
    execute: async (_toolCallId: string, params: Params) => {
      const { sqlite } = context;
      const limit = Math.min(Math.floor(params.limit ?? 3), 10);
      const mode = params.mode ?? 'mix';

      const notes = resurfaceNotes(sqlite, { limit, mode });

      if (notes.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No notes found to resurface. Your knowledge base may be empty, or all notes were surfaced recently.',
            },
          ],
          details: { count: 0 },
        };
      }

      const formatted = notes.map(formatSurfacedNote).join('\n\n');
      return {
        content: [
          {
            type: 'text' as const,
            text: `Resurfaced ${notes.length} note${notes.length !== 1 ? 's' : ''}:\n\n${formatted}`,
          },
        ],
        details: { count: notes.length, ids: notes.map((n) => n.id) },
      };
    },
  };
}
