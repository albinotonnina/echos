import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { SqliteStorage } from '../../storage/sqlite.js';
import type { MarkdownStorage } from '../../storage/markdown.js';
import type { VectorStorage } from '../../storage/vectordb.js';
import type { Logger } from 'pino';
import { categorizeContent, type ProcessingMode } from '../categorization.js';

export interface CategorizeNoteToolDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
  vectorDb: VectorStorage;
  generateEmbedding: (text: string) => Promise<number[]>;
  anthropicApiKey: string;
  logger: Logger;
}

const schema = Type.Object({
  noteId: Type.String({ description: 'ID of the note to categorize' }),
  mode: Type.Optional(
    Type.Union([Type.Literal('lightweight'), Type.Literal('full')], {
      description: 'Processing mode: "lightweight" (category+tags) or "full" (includes summary, gist, key points)',
      default: 'lightweight',
    }),
  ),
});

type Params = Static<typeof schema>;

export function createCategorizeNoteTool(
  deps: CategorizeNoteToolDeps,
): AgentTool<typeof schema> {
  return {
    name: 'categorize_note',
    label: 'Categorize Note',
    description:
      'Automatically categorize an existing note using AI. Use "lightweight" mode for quick categorization (category + tags) or "full" mode for comprehensive processing (category + tags + summary + gist + key points).',
    parameters: schema,
    execute: async (_toolCallId, params: Params) => {
      const noteRow = deps.sqlite.getNote(params.noteId);
      if (!noteRow) {
        return {
          content: [{ type: 'text' as const, text: `Note not found: ${params.noteId}` }],
          details: {},
        };
      }

      const mode: ProcessingMode = params.mode ?? 'lightweight';

      try {
        const result = await categorizeContent(
          noteRow.title,
          noteRow.content,
          mode,
          deps.anthropicApiKey,
          deps.logger,
        );

        // Parse existing note
        const note = deps.markdown.read(noteRow.filePath);
        if (!note) {
          return {
            content: [{ type: 'text' as const, text: `Failed to read note file: ${noteRow.filePath}` }],
            details: {},
          };
        }

        const metadata = note.metadata;

        // Update metadata with categorization results
        metadata.category = result.category;
        metadata.tags = result.tags;
        metadata.updated = new Date().toISOString();

        if ('gist' in result) {
          metadata.gist = result.gist;
        }

        // Save updated note
        deps.markdown.update(noteRow.filePath, metadata, noteRow.content);
        deps.sqlite.upsertNote(metadata, noteRow.content, noteRow.filePath);

        // Update vector store
        try {
          const embedText = `${noteRow.title}\n\n${noteRow.content}`;
          const vector = await deps.generateEmbedding(embedText);
          await deps.vectorDb.upsert({
            id: params.noteId,
            text: embedText,
            vector,
            type: noteRow.type,
            title: noteRow.title,
          });
        } catch {
          // Non-fatal
        }

        let responseText = `Categorized note "${noteRow.title}" (${mode} mode)\n`;
        responseText += `Category: ${result.category}\n`;
        responseText += `Tags: [${result.tags.join(', ')}]`;

        if ('gist' in result) {
          responseText += `\nGist: ${result.gist}`;
          responseText += `\nSummary: ${result.summary}`;
          responseText += `\nKey Points:\n${result.keyPoints.map((p) => `  - ${p}`).join('\n')}`;
        }

        return {
          content: [{ type: 'text' as const, text: responseText }],
          details: { id: params.noteId, mode, result },
        };
      } catch (error) {
        deps.logger.error({ error, noteId: params.noteId }, 'Categorization failed');
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to categorize note: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          details: {},
        };
      }
    },
  };
}
