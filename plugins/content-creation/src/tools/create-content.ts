import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { PluginContext } from '@echos/core';
import { v4 as uuidv4 } from 'uuid';
import type { NoteMetadata } from '@echos/shared';
import { StyleProfileStorage } from '../style/storage.js';
import { retrieveRelevantKnowledge } from '../content/knowledge-retriever.js';
import { generateContent } from '../content/generator.js';
import type { ContentType, ContentGenerationParams } from '../types.js';
import { DEFAULT_PROFILE, isDefaultProfile } from '../style/default-profile.js';

const schema = Type.Object({
  topic: Type.String({
    description: 'The topic or subject to write about',
  }),
  content_type: Type.Union(
    [
      Type.Literal('blog_post'),
      Type.Literal('article'),
      Type.Literal('thread'),
      Type.Literal('email'),
      Type.Literal('essay'),
      Type.Literal('tutorial'),
    ],
    {
      description:
        'Type of content to generate: blog_post, article, thread, email, essay, or tutorial',
    },
  ),
  target_length: Type.Optional(
    Type.Number({
      description: 'Target length in words (optional, defaults to optimal for content type)',
    }),
  ),
  use_recent_notes: Type.Optional(
    Type.Boolean({
      description: 'Only use notes from the last 30 days for context (optional)',
    }),
  ),
  audience: Type.Optional(
    Type.String({
      description: 'Target audience for the content (optional)',
    }),
  ),
  additional_instructions: Type.Optional(
    Type.String({
      description: 'Any additional specific instructions for generation (optional)',
    }),
  ),
});

type Params = Static<typeof schema>;

export function createContentTool(
  context: PluginContext,
  storage: StyleProfileStorage,
): AgentTool<typeof schema> {
  return {
    name: 'create_content',
    label: 'Create Content',
    description:
      'Generate content in your authentic voice. Creates blog posts, articles, threads, emails, essays, or tutorials using your knowledge base and learned writing style. The content will sound like you wrote it.',
    parameters: schema,
    execute: async (_toolCallId: string, params: Params) => {
      const logger = context.logger.child({ tool: 'create_content' });

      try {
        // Load style profile (or use default)
        logger.info('Loading style profile');
        let profile = await storage.load();
        let usingDefault = false;

        if (!profile) {
          logger.info('No custom profile found, using default voice profile');
          profile = DEFAULT_PROFILE;
          usingDefault = true;
        }

        // Check API key
        const anthropicApiKey = context.config.anthropicApiKey;
        if (!anthropicApiKey) {
          throw new Error('Anthropic API key not configured');
        }

        // Build generation params
        const generationParams: ContentGenerationParams = {
          topic: params.topic,
          contentType: params.content_type as ContentType,
        };

        // Add optional fields only if defined
        if (params.target_length !== undefined) {
          generationParams.targetLength = params.target_length;
        }
        if (params.use_recent_notes !== undefined) {
          generationParams.useRecentNotes = params.use_recent_notes;
        }
        if (params.audience !== undefined) {
          generationParams.audience = params.audience;
        }
        if (params.additional_instructions !== undefined) {
          generationParams.additionalInstructions = params.additional_instructions;
        }

        // Retrieve relevant knowledge
        logger.info({ topic: params.topic }, 'Retrieving relevant knowledge');
        const retrievalOptions: {
          limit: number;
          minScore: number;
          recentDays?: number;
        } = {
          limit: 15,
          minScore: 0.3,
        };
        if (params.use_recent_notes) {
          retrievalOptions.recentDays = 30;
        }

        const relevantNotes = await retrieveRelevantKnowledge(
          params.topic,
          context,
          retrievalOptions,
        );

        logger.info({ noteCount: relevantNotes.length }, 'Retrieved relevant notes');

        // Generate content
        logger.info({ contentType: params.content_type }, 'Generating content');
        const result = await generateContent(
          generationParams,
          profile,
          relevantNotes,
          anthropicApiKey,
          logger,
        );

        // Save as a new note with metadata
        const noteId = uuidv4();
        const now = new Date().toISOString();

        const metadata: NoteMetadata = {
          id: noteId,
          type: 'note',
          title: `${params.content_type.replace('_', ' ')}: ${params.topic}`,
          tags: ['generated', 'ai-generated', params.content_type],
          links: result.content.sourceNotes,
          category: params.content_type,
          created: now,
          updated: now,
        };

        // Write to markdown storage
        const filePath = context.markdown.save(metadata, result.content.content);

        // Index in SQLite
        context.sqlite.upsertNote(metadata, result.content.content, filePath);

        // Generate and store embedding
        const embedding = await context.generateEmbedding(result.content.content);
        await context.vectorDb.upsert({
          id: noteId,
          text: result.content.content,
          vector: embedding,
          type: 'note',
          title: metadata.title,
        });

        logger.info({ noteId, contentType: params.content_type }, 'Content saved as note');

        // Format response
        const wordCount = result.content.content.split(/\s+/).length;
        const previewLength = 500;
        const preview =
          result.content.content.length > previewLength
            ? result.content.content.slice(0, previewLength) + '...'
            : result.content.content;

        const costEstimate = result.tokensUsed
          ? ((result.tokensUsed.input * 3 + result.tokensUsed.output * 15) / 1_000_000).toFixed(
              4,
            )
          : 'N/A';

        const voiceNote = usingDefault
          ? '\n\n⚠️ **Using default voice profile.** For content in YOUR authentic voice:\n1. Tag 5-15 of your best notes with "voice-example"\n2. Run analyze_my_style\n3. Generate content again'
          : '';

        const text = `✅ Content generated successfully!

**Type:** ${params.content_type.replace('_', ' ')}
**Topic:** ${params.topic}
**Length:** ${wordCount} words
**Source notes:** ${result.content.sourceNotes.length} notes used for context
**Cost:** ~$${costEstimate}
**Saved as:** ${noteId}${voiceNote}

---

**Preview:**

${preview}

---

The full content has been saved as a new note. You can:
- Read it with the note ID above
- Edit it if needed
- Tag it or categorize it further
- Use it as a voice example after editing (if you polish it)

*Note: This content was AI-generated${usingDefault ? ' using a default voice profile' : ' in your voice'}. Review and edit as needed before publishing.*`;

        return {
          content: [{ type: 'text' as const, text }],
          details: {
            noteId,
            filePath,
            wordCount,
            contentType: params.content_type,
            sourceNoteCount: result.content.sourceNotes.length,
            tokensUsed: result.tokensUsed,
            usingDefaultProfile: usingDefault,
          },
        };
      } catch (error) {
        logger.error({ error }, 'Content creation failed');
        const errorText = `❌ Content creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        return {
          content: [{ type: 'text' as const, text: errorText }],
          details: { error: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },
  };
}
