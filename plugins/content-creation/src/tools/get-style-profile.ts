import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { StyleProfileStorage } from '../style/storage.js';

const schema = Type.Object({});

type Params = Static<typeof schema>;

export function createGetStyleProfileTool(storage: StyleProfileStorage): AgentTool<typeof schema> {
  return {
    name: 'get_style_profile',
    label: 'Get Style Profile',
    description:
      'Get a detailed summary of your current writing style profile. Shows voice characteristics, patterns, vocabulary, and sample paragraphs.',
    parameters: schema,
    execute: async (_toolCallId: string, _params: Params) => {
      try {
        const profile = await storage.load();

        if (!profile) {
          const text = `No style profile exists yet.

Run analyze_my_style to create your writing style profile from voice examples.`;
          return {
            content: [{ type: 'text' as const, text }],
            details: { exists: false },
          };
        }

        // Format the profile for human reading
        const text = `# Your Writing Style Profile

**Last analyzed:** ${new Date(profile.lastUpdated).toLocaleDateString()}
**Samples analyzed:** ${profile.sampleCount} voice examples
**Analysis method:** ${profile.analysisMethod}

## Voice Characteristics

**Tone:** ${profile.voiceCharacteristics.toneDescriptors.join(', ')}
**Formality:** ${profile.voiceCharacteristics.formalityLevel}
**Emotional range:** ${profile.voiceCharacteristics.emotionalRange}
**Perspective:** ${profile.voiceCharacteristics.perspective}

## Writing Style

**Sentence structure:**
- Average sentence length: ${profile.avgSentenceLength} words
- Overall tone: ${profile.tone}

**Paragraph structure:**
- Style: ${profile.structure.paragraphStyle} paragraphs
- Average paragraph length: ${profile.avgParagraphLength} words

**Structural preferences:**
- Uses lists: ${profile.structure.prefersLists ? 'Yes' : 'No'}
- Uses metaphors: ${profile.structure.usesMetaphors ? 'Yes' : 'No'}
- Storytelling approach: ${profile.structure.storytellingApproach}

## Patterns

**Common sentence starters:**
${profile.patterns.sentenceStarters.slice(0, 5).map((s) => `- "${s}"`).join('\n')}

**Transition phrases:**
${profile.patterns.transitions.slice(0, 5).map((t) => `- "${t}"`).join('\n')}

**Emphasis phrases:**
${profile.patterns.emphasisPhrases.slice(0, 3).map((e) => `- "${e}"`).join('\n')}

## Vocabulary

**Jargon level:** ${profile.vocabulary.jargonLevel}
**Vocabulary richness:** ${Math.round(profile.vocabularyRichness * 100)}%

**Signature words:**
${profile.vocabulary.signatureWords.slice(0, 10).join(', ')}

${
  profile.vocabulary.avoidedWords.length > 0
    ? `**Words you avoid:**
${profile.vocabulary.avoidedWords.slice(0, 5).join(', ')}`
    : ''
}

## Sample Paragraphs

These paragraphs exemplify your writing style:

${profile.sampleParagraphs
  .slice(0, 2)
  .map(
    (para, idx) => `**Example ${idx + 1}:**
${para}`,
  )
  .join('\n\n')}

---

*Use create_content to generate content in this voice.*`;

        return {
          content: [{ type: 'text' as const, text }],
          details: {
            exists: true,
            sampleCount: profile.sampleCount,
            lastUpdated: profile.lastUpdated,
          },
        };
      } catch (error) {
        const errorText = `❌ Failed to load style profile: ${error instanceof Error ? error.message : 'Unknown error'}`;
        return {
          content: [{ type: 'text' as const, text: errorText }],
          details: { error: error instanceof Error ? error.message : 'Unknown error' },
        };
      }
    },
  };
}
