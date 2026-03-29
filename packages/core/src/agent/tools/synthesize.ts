import { Type, StringEnum, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { streamSimple } from '@mariozechner/pi-ai';
import { v4 as uuidv4 } from 'uuid';
import { NotFoundError, ValidationError } from '@echos/shared';
import type { NoteMetadata, ContentType, InputSource } from '@echos/shared';
import type { Logger } from 'pino';
import type { SqliteStorage } from '../../storage/sqlite.js';
import type { MarkdownStorage } from '../../storage/markdown.js';
import type { VectorStorage } from '../../storage/vectordb.js';
import type { SearchService } from '../../storage/search.js';
import { resolveModel, MODEL_PRESETS } from '../model-resolver.js';

export interface SynthesizeNotesToolDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
  vectorDb: VectorStorage;
  search: SearchService;
  generateEmbedding: (text: string) => Promise<number[]>;
  anthropicApiKey?: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
  modelId?: string;
  logger: Logger;
}

const FORMATS = ['summary', 'brief', 'comparison', 'timeline'] as const;
type SynthesisFormat = (typeof FORMATS)[number];

const MAX_NOTES = 20;
const DEFAULT_MAX_NOTES = 10;
/** Max characters per note content to include in the synthesis prompt */
const MAX_CONTENT_PER_NOTE = 3000;

const schema = Type.Object({
  noteIds: Type.Optional(
    Type.Array(Type.String(), { description: 'Specific note IDs to synthesize' }),
  ),
  query: Type.Optional(
    Type.String({ description: 'Search query to find notes to synthesize' }),
  ),
  tags: Type.Optional(
    Type.Array(Type.String(), { description: 'Filter notes by tags' }),
  ),
  title: Type.String({ description: 'Title for the synthesis note', minLength: 1 }),
  format: Type.Optional(
    StringEnum([...FORMATS], {
      description:
        'Output format: summary (unified summary), brief (executive briefing), comparison (compare/contrast), timeline (chronological narrative). Default: summary',
      default: 'summary',
    }),
  ),
  maxNotes: Type.Optional(
    Type.Number({
      description: `Maximum number of notes to synthesize (default ${DEFAULT_MAX_NOTES}, max ${MAX_NOTES})`,
      default: DEFAULT_MAX_NOTES,
      minimum: 2,
      maximum: MAX_NOTES,
    }),
  ),
});

type Params = Static<typeof schema>;

function buildSynthesisPrompt(
  notes: Array<{ id: string; title: string; content: string; tags: string[]; created: string }>,
  format: SynthesisFormat,
  title: string,
): string {
  const noteBlocks = notes
    .map(
      (n, i) =>
        `### Note ${i + 1}: ${n.title} (id: ${n.id})\nCreated: ${n.created}\nTags: [${n.tags.join(', ')}]\n\n${n.content}`,
    )
    .join('\n\n---\n\n');

  const formatInstructions: Record<SynthesisFormat, string> = {
    summary:
      'Create a unified summary that synthesizes the key information from all the notes into a cohesive narrative. Identify common themes, important insights, and connections between the notes.',
    brief:
      'Create an executive briefing with: 1) Key findings/points (bulleted), 2) Main themes identified, 3) Conclusions and takeaways. Be concise and actionable.',
    comparison:
      'Compare and contrast the perspectives, approaches, or information across the notes. Identify agreements, disagreements, complementary viewpoints, and gaps.',
    timeline:
      'Organize the information from the notes into a chronological narrative. Use dates from the notes when available. Show how ideas, events, or knowledge evolved over time.',
  };

  return `You are synthesizing ${notes.length} notes into a new note titled "${title}".

Format: ${format}

${formatInstructions[format]}

Write the synthesis in markdown. Do NOT include a title heading — the title is stored separately.
Do NOT wrap the output in code fences. Just output the markdown content directly.

---

${noteBlocks}`;
}

function truncateContent(content: string, maxLen: number): string {
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen) + '\n\n[...truncated]';
}

export function createSynthesizeNotesTool(
  deps: SynthesizeNotesToolDeps,
): AgentTool<typeof schema> {
  return {
    name: 'synthesize_notes',
    label: 'Synthesize Notes',
    description:
      'Synthesize multiple notes into a new summary note. Provide noteIds, a search query, or tags to select source notes. Supports four formats: summary, brief, comparison, timeline.',
    parameters: schema,
    execute: async (_toolCallId: string, params: Params) => {
      const format: SynthesisFormat = params.format ?? 'summary';
      const maxNotes = Math.min(params.maxNotes ?? DEFAULT_MAX_NOTES, MAX_NOTES);

      // --- Validate exactly one selector is provided ---
      const hasNoteIds = params.noteIds && params.noteIds.length > 0;
      const hasQuery = !!params.query;
      const hasTags = params.tags && params.tags.length > 0;
      const selectorCount = [hasNoteIds, hasQuery, hasTags].filter(Boolean).length;

      if (selectorCount === 0) {
        throw new ValidationError(
          'At least one selector must be provided: noteIds, query, or tags.',
        );
      }
      if (selectorCount > 1) {
        throw new ValidationError(
          'Only one selector may be provided at a time: noteIds, query, or tags.',
        );
      }

      // --- Resolve source notes ---
      const sourceNotes: Array<{
        id: string;
        title: string;
        content: string;
        tags: string[];
        created: string;
      }> = [];

      if (hasNoteIds) {
        // Deduplicate noteIds while preserving order
        const uniqueIds = [...new Set(params.noteIds!)].slice(0, maxNotes);
        for (const id of uniqueIds) {
          const row = deps.sqlite.getNote(id);
          if (!row) {
            throw new NotFoundError('note', id);
          }

          // Prefer markdown file as source of truth when available, fall back to SQLite.
          let title = row.title;
          let content = row.content;
          let tags = row.tags ? row.tags.split(',').filter(Boolean) : [];

          if (row.filePath) {
            try {
              const markdownNote = deps.markdown.read(row.filePath);
              if (markdownNote) {
                title = markdownNote.metadata.title;
                content = markdownNote.content;
                tags = markdownNote.metadata.tags ?? tags;
              }
            } catch (err: unknown) {
              deps.logger.warn(
                { err, noteId: id, filePath: row.filePath },
                'Failed to read markdown for note; falling back to SQLite content',
              );
            }
          }

          sourceNotes.push({
            id: row.id,
            title,
            content: truncateContent(content, MAX_CONTENT_PER_NOTE),
            tags,
            created: row.created,
          });
        }
      } else if (hasQuery) {
        const vector = await deps.generateEmbedding(params.query!);
        const results = await deps.search.hybrid({
          query: params.query!,
          vector,
          limit: maxNotes,
        });
        for (const r of results) {
          sourceNotes.push({
            id: r.note.metadata.id,
            title: r.note.metadata.title,
            content: truncateContent(r.note.content, MAX_CONTENT_PER_NOTE),
            tags: r.note.metadata.tags,
            created: r.note.metadata.created,
          });
        }
      } else if (hasTags) {
        const rows = deps.sqlite.listNotes({ tags: params.tags!, limit: maxNotes });
        for (const row of rows) {
          sourceNotes.push({
            id: row.id,
            title: row.title,
            content: truncateContent(row.content, MAX_CONTENT_PER_NOTE),
            tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
            created: row.created,
          });
        }
      }

      if (sourceNotes.length < 2) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Need at least 2 notes to synthesize, but found ${sourceNotes.length}. Try broadening your search or providing more note IDs.`,
            },
          ],
          details: { noteCount: sourceNotes.length },
        };
      }

      // --- Call LLM to synthesize ---
      const model = resolveModel(deps.modelId ?? MODEL_PRESETS.fast, deps.llmBaseUrl);
      const apiKey =
        (model.provider as string) === 'anthropic'
          ? (deps.anthropicApiKey ?? '')
          : (deps.llmApiKey ?? '');

      const prompt = buildSynthesisPrompt(sourceNotes, format, params.title);

      let synthesisContent = '';
      try {
        const stream = streamSimple(
          model,
          { messages: [{ role: 'user', content: prompt, timestamp: Date.now() }] },
          { apiKey, maxTokens: 4000 },
        );

        for await (const event of stream) {
          if (event.type === 'text_delta') {
            synthesisContent += event.delta;
          }
        }
      } catch (error: unknown) {
        deps.logger.error(
          { err: error, tool: 'synthesize_notes', model },
          'LLM streaming failed in synthesize_notes tool',
        );

        return {
          content: [
            {
              type: 'text' as const,
              text:
                'Failed to generate a synthesis due to an error communicating with the language model. ' +
                'Please check your LLM configuration (API key, network, and provider status) and try again.',
            },
          ],
          details: { error: 'llm_stream_error' },
        };
      }

      synthesisContent = synthesisContent.trim();

      if (!synthesisContent) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'LLM returned empty synthesis. Please try again.',
            },
          ],
          details: {},
        };
      }

      // --- Collect all unique tags from source notes + add 'synthesis' tag ---
      const allTags = new Set<string>();
      allTags.add('synthesis');
      for (const note of sourceNotes) {
        for (const tag of note.tags) {
          allTags.add(tag);
        }
      }

      // --- Save as a new note ---
      const now = new Date().toISOString();
      const id = uuidv4();
      const sourceIds = sourceNotes.map((n) => n.id);
      const type: ContentType = 'note';

      const metadata: NoteMetadata = {
        id,
        type,
        title: params.title,
        created: now,
        updated: now,
        tags: [...allTags],
        links: sourceIds,
        category: 'uncategorized',
        status: 'read',
        inputSource: 'text',
      };

      const filePath = deps.markdown.save(metadata, synthesisContent);
      deps.sqlite.upsertNote(metadata, synthesisContent, filePath);

      // Generate embedding for the synthesis note
      try {
        const embedText = `${params.title}\n\n${synthesisContent}`;
        const vector = await deps.generateEmbedding(embedText);
        await deps.vectorDb.upsert({
          id,
          text: embedText,
          vector,
          type,
          title: params.title,
        });
      } catch {
        // Embedding failure is non-fatal
      }

      // Link source notes back to the synthesis (bidirectional)
      for (const sourceId of sourceIds) {
        const row = deps.sqlite.getNote(sourceId);
        if (!row) continue;

        if (!row.filePath) {
          deps.logger.warn(
            { sourceId, synthesisId: id },
            'Source note has no markdown file; backlink could not be written',
          );
          // Still update the links array in SQLite so the relationship is at least recorded
          const existingLinks = row.links ? row.links.split(',').filter(Boolean) : [];
          if (!existingLinks.includes(id)) {
            deps.sqlite.upsertNote(
              {
                id: row.id,
                type: row.type as ContentType,
                title: row.title,
                created: row.created,
                updated: new Date().toISOString(),
                tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
                links: [...existingLinks, id],
                category: row.category ?? 'uncategorized',
                status: row.status ?? 'read',
                inputSource: (row.inputSource as InputSource | undefined) ?? 'text',
              },
              row.content,
              row.filePath,
            );
          }
          continue;
        }

        const note = deps.markdown.read(row.filePath);
        if (!note) {
          deps.logger.warn(
            { sourceId, filePath: row.filePath, synthesisId: id },
            'Source note markdown file missing; backlink could not be written',
          );
          continue;
        }

        if (!note.metadata.links.includes(id)) {
          const updatedLinks = [...note.metadata.links, id];
          const updatedNote = deps.markdown.update(row.filePath, { links: updatedLinks });
          deps.sqlite.upsertNote(
            updatedNote.metadata,
            updatedNote.content,
            row.filePath,
          );
        }
      }

      const sourceList = sourceNotes
        .map((n) => `- "${n.title}" (id: ${n.id})`)
        .join('\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `Created synthesis note "${params.title}" (id: ${id}, format: ${format})\n\nSynthesized from ${sourceNotes.length} notes:\n${sourceList}\n\nTags: [${[...allTags].join(', ')}]`,
          },
        ],
        details: { id, filePath, format, sourceCount: sourceNotes.length, sourceIds },
      };
    },
  };
}
