import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { SqliteStorage } from '../../storage/sqlite.js';
import type { MarkdownStorage } from '../../storage/markdown.js';
import type { VectorStorage } from '../../storage/vectordb.js';
import type { Logger } from 'pino';
import { categorizeContent, type ProcessingMode, DEFAULT_CATEGORIZATION_MODEL } from '../categorization.js';
import { resolveModel } from '../model-resolver.js';
import { suggestLinks } from '../../graph/auto-linker.js';

export interface CategorizeNoteToolDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
  vectorDb: VectorStorage;
  generateEmbedding: (text: string) => Promise<number[]>;
  anthropicApiKey?: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
  modelId?: string;
  logger: Logger;
}

const schema = Type.Object({
  noteId: Type.String({ description: 'ID of the note to categorize' }),
  mode: Type.Optional(
    Type.Union([Type.Literal('lightweight'), Type.Literal('full')], {
      description:
        'Processing mode: "lightweight" (category+tags) or "full" (includes summary, gist, key points)',
      default: 'lightweight',
    }),
  ),
});

type Params = Static<typeof schema>;

export function createCategorizeNoteTool(deps: CategorizeNoteToolDeps): AgentTool<typeof schema> {
  return {
    name: 'categorize_note',
    label: 'Categorize Note',
    description:
      'Categorize an existing note using AI. Use "lightweight" mode for quick categorization (category + tags) — preferred after create_note. Use "full" mode for important content needing summary + gist + key points.',
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
        const model = resolveModel(deps.modelId ?? DEFAULT_CATEGORIZATION_MODEL, deps.llmBaseUrl);
        const apiKey =
          (model.provider as string) === 'anthropic'
            ? (deps.anthropicApiKey ?? '')
            : (deps.llmApiKey ?? '');

        // Parse existing note first — disk is source of truth for content and metadata
        const existingNote = deps.markdown.read(noteRow.filePath);
        // Prefer on-disk content as source of truth; fall back to SQLite if the file is missing
        const noteContent = existingNote?.content ?? noteRow.content;
        const oldCategory = existingNote?.metadata.category ?? noteRow.category;
        const existingMetadata = existingNote?.metadata ?? {
          id: noteRow.id,
          type: noteRow.type,
          title: noteRow.title,
          created: noteRow.created,
          updated: noteRow.updated,
          tags: noteRow.tags ? noteRow.tags.split(',').filter(Boolean) : [],
          links: noteRow.links ? noteRow.links.split(',').filter(Boolean) : [],
          category: noteRow.category,
        };

        const vocabulary = deps.sqlite.getTopTagsWithCounts(50);
        const result = await categorizeContent(
          existingMetadata.title,
          noteContent,
          mode,
          apiKey,
          deps.logger,
          undefined,
          deps.modelId,
          deps.llmBaseUrl,
          vocabulary,
        );

        // Update metadata with categorization results
        const metadata = {
          ...existingMetadata,
          category: result.category,
          tags: result.tags,
          updated: new Date().toISOString(),
          ...('gist' in result ? { gist: result.gist } : {}),
        };

        // If category changed, move the file to the new directory
        let savedFilePath: string;
        if (result.category !== oldCategory || !existingNote) {
          savedFilePath = deps.markdown.save(metadata, noteContent);
          if (existingNote) {
            deps.markdown.remove(noteRow.filePath);
          }
        } else {
          deps.markdown.update(noteRow.filePath, metadata, noteContent);
          savedFilePath = noteRow.filePath;
        }

        deps.sqlite.upsertNote(metadata, noteContent, savedFilePath);

        // Update vector store — keep the vector for reuse in link suggestions below
        let noteVector: number[] | undefined;
        try {
          const embedText = `${metadata.title}\n\n${noteContent}`;
          noteVector = await deps.generateEmbedding(embedText);
          await deps.vectorDb.upsert({
            id: params.noteId,
            text: embedText,
            vector: noteVector,
            type: noteRow.type,
            title: metadata.title,
          });
        } catch {
          // Non-fatal
        }

        let responseText = `Categorized note "${metadata.title}" (${mode} mode)\n`;
        responseText += `Category: ${result.category}\n`;
        responseText += `Tags: [${result.tags.join(', ')}]`;

        if ('gist' in result) {
          responseText += `\nGist: ${result.gist}`;
          responseText += `\nSummary: ${result.summary}`;
          responseText += `\nKey Points:\n${result.keyPoints.map((p) => `  - ${p}`).join('\n')}`;
        }

        // Auto-suggest links after categorization (non-fatal if it fails)
        try {
          const linkSuggestions = await suggestLinks(
            params.noteId,
            deps.sqlite,
            deps.vectorDb,
            deps.generateEmbedding,
            3,
            undefined,
            noteVector,
          );
          if (linkSuggestions.length > 0) {
            responseText += '\n\n**Link Suggestions:**';
            for (const s of linkSuggestions) {
              responseText += `\n- **${s.targetTitle}** (id: \`${s.targetId}\`) — ${(s.similarity * 100).toFixed(1)}% similar, ${s.reason}`;
            }
            responseText += '\nUse `link_notes` to connect any of these.';
          }
        } catch {
          // Non-fatal: link suggestions are best-effort
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
