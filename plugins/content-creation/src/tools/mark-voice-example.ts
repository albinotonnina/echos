import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { PluginContext } from '@echos/core';

const VOICE_EXAMPLE_TAG = 'voice-example';

const schema = Type.Object({
  note_id: Type.String({
    description: 'ID of the note to mark as a voice example',
  }),
});

type Params = Static<typeof schema>;

export function createMarkVoiceExampleTool(context: PluginContext): AgentTool<typeof schema> {
  return {
    name: 'mark_as_voice_example',
    label: 'Mark as Voice Example',
    description:
      'Mark a note as a voice example to include it in style analysis. Voice examples should be polished, representative pieces of your writing (500+ words recommended).',
    parameters: schema,
    execute: async (_toolCallId: string, params: Params) => {
      const logger = context.logger.child({ tool: 'mark_as_voice_example' });

      try {
        // Get the note
        const noteRow = context.sqlite.getNote(params.note_id);
        if (!noteRow) {
          const text = `❌ Note not found: ${params.note_id}`;
          return {
            content: [{ type: 'text' as const, text }],
            details: { error: 'note_not_found' },
          };
        }

        // Parse existing tags
        const existingTags = noteRow.tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0);

        // Check if already tagged
        if (existingTags.includes(VOICE_EXAMPLE_TAG)) {
          const text = `✅ Note "${noteRow.title}" is already marked as a voice example.`;
          return {
            content: [{ type: 'text' as const, text }],
            details: { alreadyMarked: true },
          };
        }

        // Add the voice-example tag
        const newTags = [...existingTags, VOICE_EXAMPLE_TAG];

        // Read the full note from markdown
        const note = context.markdown.read(noteRow.filePath);
        if (!note) {
          throw new Error(`Could not read note from ${noteRow.filePath}`);
        }

        // Update metadata with new tags
        note.metadata.tags = newTags;

        // Save back to markdown (which will trigger SQLite update via upsertNote)
        const filePath = context.markdown.save(note.metadata, note.content);

        // Also update SQLite directly to ensure consistency
        context.sqlite.upsertNote(note.metadata, note.content, filePath);

        logger.info(
          { noteId: params.note_id, title: noteRow.title },
          'Marked note as voice example',
        );

        const text = `✅ Marked "${noteRow.title}" as a voice example.

This note will now be included when you run analyze_my_style.

**Word count:** ~${note.content.split(/\s+/).length} words
**Current tags:** ${newTags.join(', ')}`;

        return {
          content: [{ type: 'text' as const, text }],
          details: {
            noteId: params.note_id,
            title: noteRow.title,
            tags: newTags,
          },
        };
      } catch (error) {
        logger.error({ error, noteId: params.note_id }, 'Failed to mark note as voice example');
        const errorText = `❌ Failed to mark note as voice example: ${error instanceof Error ? error.message : 'Unknown error'}`;
        return {
          content: [{ type: 'text' as const, text: errorText }],
          details: { error: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },
  };
}
