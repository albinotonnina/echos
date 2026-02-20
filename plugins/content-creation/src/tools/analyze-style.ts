import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { PluginContext } from '@echos/core';
import { analyzeStyle } from '@echos/core';
import { StyleProfileStorage } from '../style/storage.js';
import { analyzeLinguisticStyle } from '../style/llm-analyzer.js';
import { buildEnhancedProfile } from '../style/profile-builder.js';

const VOICE_EXAMPLE_TAG = 'voice-example';
const DEFAULT_MIN_EXAMPLES = 5;

const schema = Type.Object({
  force_reanalysis: Type.Optional(
    Type.Boolean({
      description: 'Force re-analysis even if profile exists',
    }),
  ),
  min_examples: Type.Optional(
    Type.Number({
      description: 'Minimum number of voice examples required (default: 5)',
    }),
  ),
});

type Params = Static<typeof schema>;

export function createAnalyzeStyleTool(
  context: PluginContext,
  storage: StyleProfileStorage,
): AgentTool<typeof schema> {
  return {
    name: 'analyze_my_style',
    label: 'Analyze My Style',
    description:
      'Analyze your writing style from curated voice examples. Use this to learn your authentic voice from notes tagged as "voice-example". Returns a detailed profile of your writing characteristics.',
    parameters: schema,
    execute: async (_toolCallId: string, params: Params) => {
      const logger = context.logger.child({ tool: 'analyze_my_style' });
      const minExamples = params.min_examples ?? DEFAULT_MIN_EXAMPLES;

      try {
        // Check if profile already exists
        if (!params.force_reanalysis && storage.exists()) {
          const existing = await storage.load();
          if (existing) {
            const text = `Style profile already exists (analyzed ${existing.sampleCount} voice examples on ${new Date(existing.lastUpdated).toLocaleDateString()}).

Your voice: ${existing.voiceCharacteristics.toneDescriptors.join(', ')} | ${existing.voiceCharacteristics.formalityLevel} | ${existing.structure.paragraphStyle} paragraphs

Use force_reanalysis=true to update, or use get_style_profile to see full details.`;
            return {
              content: [{ type: 'text' as const, text }],
              details: { existed: true, profile: existing },
            };
          }
        }

        logger.info('Searching for voice example notes');

        // Query notes directly by tag to avoid FTS5 parsing issues with hyphenated tags
        let voiceExamples;
        try {
          voiceExamples = context.sqlite.listNotes({ tags: [VOICE_EXAMPLE_TAG], limit: 100 });
        } catch (dbError) {
          logger.error(
            {
              message: dbError instanceof Error ? dbError.message : String(dbError),
              stack: dbError instanceof Error ? dbError.stack : undefined,
              code: (dbError as Record<string, unknown>)['code'],
              details: JSON.stringify(dbError),
            },
            'SQLite query failed when searching for voice examples',
          );
          throw dbError;
        }

        logger.info({ count: voiceExamples.length }, 'Found voice example notes');

        // Check minimum threshold
        if (voiceExamples.length < minExamples) {
          const text = `⚠️ Not enough voice examples found.

Found: ${voiceExamples.length} notes tagged with "${VOICE_EXAMPLE_TAG}"
Needed: ${minExamples} minimum

To build an accurate style profile, you need to curate ${minExamples - voiceExamples.length} more voice examples.

**What makes a good voice example?**
- Published work you're proud of
- Polished pieces (not rough drafts)
- Content that represents your authentic voice
- 500+ words of your writing

**How to add voice examples:**
1. Save or create notes with your best writing
2. Tag them with "${VOICE_EXAMPLE_TAG}"
3. Run analyze_my_style again

You can also use the mark_as_voice_example tool to tag existing notes.

**Note:** You can still use create_content right now - it will use a default professional voice profile until you create your custom one.`;
          return {
            content: [{ type: 'text' as const, text }],
            details: { found: voiceExamples.length, needed: minExamples },
          };
        }

        // Extract text content from voice examples
        const texts = voiceExamples.map((note) => {
          // Read full content from markdown file
          try {
            const fullNote = context.markdown.read(note.filePath);
            if (fullNote) {
              return fullNote.content;
            }
            // Fallback to content from database if read returns undefined
            return note.content;
          } catch {
            // Fallback to content from database if file read fails
            return note.content;
          }
        });

        logger.info({ textCount: texts.length }, 'Running style analysis');

        // Run statistical analysis using core function
        const statisticalProfile = analyzeStyle(texts, logger);

        // Run LLM analysis
        const anthropicApiKey = context.config.anthropicApiKey;
        if (!anthropicApiKey) {
          throw new Error('Anthropic API key not configured');
        }

        const llmAnalysis = await analyzeLinguisticStyle(
          texts,
          anthropicApiKey,
          logger,
          context.config['defaultModel'] as string,
        );

        // Merge into enhanced profile
        const enhancedProfile = buildEnhancedProfile(statisticalProfile, llmAnalysis);

        // Save profile
        await storage.save(enhancedProfile);

        logger.info('Style analysis complete and saved');

        // Return summary
        const text = `✅ Style analysis complete!

**Analyzed:** ${enhancedProfile.sampleCount} voice examples
**Your voice characteristics:**
- Tone: ${enhancedProfile.voiceCharacteristics.toneDescriptors.join(', ')}
- Formality: ${enhancedProfile.voiceCharacteristics.formalityLevel}
- Emotional range: ${enhancedProfile.voiceCharacteristics.emotionalRange}
- Perspective: ${enhancedProfile.voiceCharacteristics.perspective}

**Writing style:**
- Average sentence length: ${enhancedProfile.avgSentenceLength} words (${enhancedProfile.tone})
- Paragraph style: ${enhancedProfile.structure.paragraphStyle}
- Prefers lists: ${enhancedProfile.structure.prefersLists ? 'Yes' : 'No'}
- Uses metaphors: ${enhancedProfile.structure.usesMetaphors ? 'Yes' : 'No'}
- Storytelling approach: ${enhancedProfile.structure.storytellingApproach}

**Signature elements:**
- Top phrases: ${enhancedProfile.patterns.sentenceStarters.slice(0, 3).join(', ')}
- Jargon level: ${enhancedProfile.vocabulary.jargonLevel}
- Vocabulary richness: ${Math.round(enhancedProfile.vocabularyRichness * 100)}%

Your style profile is ready! Use create_content to generate content in your voice.`;

        return {
          content: [{ type: 'text' as const, text }],
          details: {
            profile: enhancedProfile,
            sampleCount: enhancedProfile.sampleCount,
          },
        };
      } catch (error) {
        logger.error(
          {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            code: (error as Record<string, unknown>)['code'],
            details: JSON.stringify(error),
          },
          'Style analysis failed',
        );

        // Provide specific guidance based on error type
        let errorText = '❌ Style analysis failed.\n\n';

        if (error instanceof Error) {
          const errorMsg = error.message;

          // API authentication errors
          if (errorMsg.includes('authentication') || errorMsg.includes('API key')) {
            errorText += `**Authentication Error**\n${errorMsg}\n\nPlease verify your Anthropic API key is correctly configured in your environment.`;
          }
          // Rate limit errors
          else if (errorMsg.includes('rate limit')) {
            errorText += `**Rate Limit Error**\n${errorMsg}\n\nYour Anthropic API has hit its rate limit. Please wait a few minutes and try again.`;
          }
          // Network/connection errors
          else if (
            errorMsg.includes('connect') ||
            errorMsg.includes('network') ||
            errorMsg.includes('internet')
          ) {
            errorText += `**Network Error**\n${errorMsg}\n\nPlease check your internet connection and try again.`;
          }
          // API server errors (5xx)
          else if (errorMsg.includes('server error')) {
            errorText += `**API Server Error**\n${errorMsg}\n\nThis is a temporary issue with Anthropic's API. Your voice examples are saved - just try running analyze_my_style again in a few minutes.`;
          }
          // JSON parsing errors
          else if (errorMsg.includes('parse') || errorMsg.includes('JSON')) {
            errorText += `**Response Parsing Error**\n${errorMsg}\n\nThe AI returned an unexpected response format. This is usually temporary - please try again.`;
          }
          // Generic error with message
          else {
            errorText += `**Error Details**\n${errorMsg}\n\nYour voice examples are still saved. Please try again or contact support if the issue persists.`;
          }
        } else {
          errorText +=
            'An unknown error occurred. Please try again or contact support if the issue persists.';
        }

        return {
          content: [{ type: 'text' as const, text: errorText }],
          details: {
            error: error instanceof Error ? error.message : 'Unknown error',
            errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
          },
        };
      }
    },
  };
}
