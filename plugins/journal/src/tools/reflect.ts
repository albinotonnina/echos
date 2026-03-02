import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { AgentEvent } from '@mariozechner/pi-agent-core';
import { createEchosAgent } from '@echos/core';
import type { PluginContext } from '@echos/core';

const MAX_ENTRIES = 50;
const MAX_CONTENT_PER_ENTRY = 2000;
const MAX_LOOKBACK_DAYS = 365;

const schema = Type.Object({
  period: Type.Optional(
    Type.Union(
      [Type.Literal('week'), Type.Literal('month'), Type.Literal('custom')],
      { description: 'Time period for reflection (default: week)', default: 'week' },
    ),
  ),
  dateFrom: Type.Optional(
    Type.String({ description: 'Start date for custom range (ISO 8601, e.g. "2025-08-01")' }),
  ),
  dateTo: Type.Optional(
    Type.String({ description: 'End date for custom range (ISO 8601, e.g. "2025-08-31")' }),
  ),
});

type Params = Static<typeof schema>;

function calculateDateRange(params: Params): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const dateTo = params.dateTo ?? now.toISOString();

  if (params.period === 'custom' && params.dateFrom) {
    const from = new Date(params.dateFrom);
    const to = new Date(dateTo);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new Error('Invalid date format. Use ISO 8601 (e.g. "2025-08-01").');
    }
    if (from > to) {
      throw new Error('dateFrom must be before dateTo.');
    }

    const diffDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > MAX_LOOKBACK_DAYS) {
      throw new Error(`Date range cannot exceed ${MAX_LOOKBACK_DAYS} days.`);
    }

    return { dateFrom: params.dateFrom, dateTo };
  }

  const lookbackDays = params.period === 'month' ? 30 : 7;
  const from = new Date(now);
  from.setDate(from.getDate() - lookbackDays);

  return { dateFrom: from.toISOString(), dateTo };
}

function buildReflectionPrompt(
  entries: Array<{ title: string; created: string; content: string }>,
  dateFrom: string,
  dateTo: string,
): string {
  const fromDate = new Date(dateFrom).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const toDate = new Date(dateTo).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const entrySummaries = entries.map((e) => {
    const truncated =
      e.content.length > MAX_CONTENT_PER_ENTRY
        ? e.content.slice(0, MAX_CONTENT_PER_ENTRY) + '...'
        : e.content;
    return `### ${e.title} (${new Date(e.created).toLocaleDateString('en-US')})\n${truncated}`;
  });

  return `You are reflecting on a user's journal entries from ${fromDate} to ${toDate}.

Here are ${entries.length} journal entries:

${entrySummaries.join('\n\n---\n\n')}

Generate a thoughtful, empathetic reflection that includes:
1. **Key themes** — recurring topics or concerns
2. **Mood & energy patterns** — emotional trajectory across the entries
3. **Notable insights** — important realizations or breakthroughs
4. **Connections** — links between different entries that the user might not have noticed
5. **Gentle suggestions** — actionable, supportive ideas based on what you've read

Keep the tone warm and supportive. Use Markdown formatting. Do NOT use any tools — just write the reflection directly.`;
}

export function createReflectTool(context: PluginContext): AgentTool<typeof schema> {
  return {
    name: 'reflect',
    label: 'Journal Reflection',
    description:
      'Generate an AI reflection and synthesis of journal entries over a time period. Use when the user asks for a journal reflection, weekly review, mood summary, or wants to look back at their journaling patterns.',
    parameters: schema,
    execute: async (_toolCallId, params: Params) => {
      let dateFrom: string;
      let dateTo: string;

      try {
        const range = calculateDateRange(params);
        dateFrom = range.dateFrom;
        dateTo = range.dateTo;
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: (err as Error).message }],
          details: {},
        };
      }

      const rows = context.sqlite.listNotes({
        type: 'journal',
        dateFrom,
        dateTo,
        limit: MAX_ENTRIES,
        orderBy: 'created',
        order: 'asc',
      });

      if (rows.length === 0) {
        const period = params.period === 'month' ? 'month' : params.period === 'custom' ? 'date range' : 'week';
        return {
          content: [
            {
              type: 'text' as const,
              text: `No journal entries found for the past ${period}. Start journaling to build a history for reflection!`,
            },
          ],
          details: {},
        };
      }

      // Read full content for each entry
      const entries = rows.map((row) => {
        const note = context.markdown.readById(row.id);
        return {
          title: row.title,
          created: row.created,
          content: note?.content ?? row.content ?? '',
        };
      });

      const prompt = buildReflectionPrompt(entries, dateFrom, dateTo);

      // Spawn sub-agent to generate the reflection (disable tools to prevent confusion and save tokens)
      const agent = createEchosAgent({
        ...context.getAgentDeps(),
        disableCoreTools: true,
        pluginTools: [],
      });

      let textBuffer = '';
      let toolExecuted = false;
      const unsubscribe = agent.subscribe((event: AgentEvent) => {
        if (event.type === 'message_update' && 'assistantMessageEvent' in event) {
          const ame = event.assistantMessageEvent;
          if (ame.type === 'text_delta') {
            if (toolExecuted) {
              textBuffer = '';
              toolExecuted = false;
            }
            textBuffer += ame.delta;
          }
        }
        if (event.type === 'tool_execution_start') {
          toolExecuted = true;
        }
      });

      try {
        await agent.prompt(prompt);
      } catch (err) {
        context.logger.error({ err }, 'Reflection sub-agent failed');
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Reflection generation failed. Please try again later.',
            },
          ],
          details: {},
        };
      } finally {
        unsubscribe();
      }

      const reflection = textBuffer.trim();
      if (!reflection) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Could not generate reflection. Please try again.',
            },
          ],
          details: {},
        };
      }

      return {
        content: [{ type: 'text' as const, text: reflection }],
        details: {
          entryCount: entries.length,
          dateFrom,
          dateTo,
        },
      };
    },
  };
}
