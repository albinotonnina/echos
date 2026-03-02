import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { v4 as uuidv4 } from 'uuid';
import type { NoteMetadata, InputSource } from '@echos/shared';
import type { PluginContext } from '@echos/core';

const schema = Type.Object({
  title: Type.String({ description: 'Journal entry title', minLength: 1, maxLength: 500 }),
  content: Type.String({ description: 'Journal entry content in markdown', minLength: 1 }),
  tags: Type.Optional(Type.Array(Type.String(), { description: 'Tags for categorization' })),
  category: Type.Optional(
    Type.String({ description: 'Category (e.g. "reflection", "work", "health", "gratitude")' }),
  ),
  inputSource: Type.Optional(
    Type.Union([Type.Literal('text'), Type.Literal('voice')], {
      description: 'How the entry was captured',
    }),
  ),
});

type Params = Static<typeof schema>;

export function createJournalTool(context: PluginContext): AgentTool<typeof schema> {
  return {
    name: 'journal',
    label: 'Journal Entry',
    description:
      'Create a journal or diary entry. Use this tool for journal entries, daily reflections, mood logs, gratitude notes, and personal diary writing. For voice transcriptions pass inputSource="voice". After creating, ALWAYS call categorize_note (mode="lightweight") to assign category and tags. Do NOT use create_note for journal entries.',
    parameters: schema,
    execute: async (_toolCallId: string, params: Params) => {
      const now = new Date().toISOString();
      const id = uuidv4();

      const metadata: NoteMetadata = {
        id,
        type: 'journal',
        title: params.title,
        created: now,
        updated: now,
        tags: params.tags ?? [],
        links: [],
        category: params.category ?? 'uncategorized',
        status: 'read',
        inputSource: (params.inputSource as InputSource | undefined) ?? 'text',
      };

      const filePath = context.markdown.save(metadata, params.content);
      context.sqlite.upsertNote(metadata, params.content, filePath);

      const embedText = `${params.title}\n\n${params.content}`;
      try {
        const vector = await context.generateEmbedding(embedText);
        await context.vectorDb.upsert({
          id,
          text: embedText,
          vector,
          type: 'journal',
          title: params.title,
        });
      } catch {
        // Embedding failure is non-fatal
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Created journal entry "${params.title}" (id: ${id}) with tags: [${(params.tags ?? []).join(', ')}], category: ${params.category ?? 'uncategorized'}.`,
          },
        ],
        details: { id, filePath, type: 'journal' },
      };
    },
  };
}
