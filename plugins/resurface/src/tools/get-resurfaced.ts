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
      'Retrieves notes from your knowledge base that you have not seen in a while, or that you saved on this same calendar date in a prior year. Use this when the user asks to "surprise me", "what did I save before", "on this day", or wants a serendipitous knowledge review. Updates each note\'s last-surfaced timestamp.',
    parameters: schema,
    execute: async (_toolCallId, params: Params) => {
      const { sqlite } = context;
      const limit = Math.min(params.limit ?? 3, 10);
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
