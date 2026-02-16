import type { EnhancedStyleProfile, ContentType, ContentGenerationParams } from '../types.js';
import { getTemplate } from './templates.js';

/**
 * Build style instructions from the enhanced profile
 */
export function buildStyleInstructions(profile: EnhancedStyleProfile): string {
  return `## Writing Style Guidelines

**Voice Characteristics:**
- Tone: ${profile.voiceCharacteristics.toneDescriptors.join(', ')}
- Formality: ${profile.voiceCharacteristics.formalityLevel}
- Emotional range: ${profile.voiceCharacteristics.emotionalRange}
- Perspective: ${profile.voiceCharacteristics.perspective}

**Sentence & Paragraph Structure:**
- Average sentence length: ${profile.avgSentenceLength} words
- Typical tone: ${profile.tone}
- Paragraph style: ${profile.structure.paragraphStyle}
- Prefers lists: ${profile.structure.prefersLists ? 'Yes' : 'No'}
- Uses metaphors: ${profile.structure.usesMetaphors ? 'Yes' : 'No'}
- Storytelling approach: ${profile.structure.storytellingApproach}

**Common Patterns:**
- Sentence starters: ${profile.patterns.sentenceStarters.slice(0, 5).join(', ')}
- Transitions: ${profile.patterns.transitions.slice(0, 5).join(', ')}
- Emphasis phrases: ${profile.patterns.emphasisPhrases.slice(0, 3).join(', ')}

**Vocabulary:**
- Jargon level: ${profile.vocabulary.jargonLevel}
- Vocabulary richness: ${Math.round(profile.vocabularyRichness * 100)}%
${profile.vocabulary.signatureWords.length > 0 ? `- Signature words: ${profile.vocabulary.signatureWords.slice(0, 10).join(', ')}` : ''}

**Few-Shot Examples:**
Here are sample paragraphs that exemplify this writing style:

${profile.sampleParagraphs
  .slice(0, 3)
  .map((para, idx) => `Example ${idx + 1}:\n${para}`)
  .join('\n\n')}`;
}

/**
 * Build knowledge context from retrieved notes
 */
export function buildKnowledgeContext(
  relevantNotes: Array<{ id: string; title: string; content: string; excerpt?: string }>,
): string {
  if (relevantNotes.length === 0) {
    return 'No specific knowledge context available. Generate based on general knowledge and the topic provided.';
  }

  return `## Relevant Knowledge from Notes

Use the following information from the user's knowledge base as context. Draw from these notes to inform your writing:

${relevantNotes
  .map((note, idx) => {
    const content = note.excerpt ?? note.content.slice(0, 500);
    return `### Note ${idx + 1}: ${note.title}
${content}${content.length >= 500 ? '...' : ''}`;
  })
  .join('\n\n')}

**Important:** Use these notes as factual sources. The content you generate should reflect the user's actual knowledge and perspectives from these notes.`;
}

/**
 * Build the complete content generation prompt
 */
export function buildContentPrompt(
  params: ContentGenerationParams,
  profile: EnhancedStyleProfile,
  relevantNotes: Array<{ id: string; title: string; content: string; excerpt?: string }>,
): string {
  const template = getTemplate(params.contentType);
  const targetLength = params.targetLength ?? template.lengthGuidelines.optimal;

  const styleInstructions = buildStyleInstructions(profile);
  const knowledgeContext = buildKnowledgeContext(relevantNotes);

  return `You are a writing assistant that generates content in the user's authentic voice. Your goal is to create content that sounds like the user wrote it themselves.

${styleInstructions}

${knowledgeContext}

## Content Requirements

**Topic:** ${params.topic}

**Content Type:** ${template.name}
${template.description}

**Structure to Follow:**
${template.structure.map((item, idx) => `${idx + 1}. ${item}`).join('\n')}

**Style Guide for ${template.name}:**
${template.styleGuide}

**Length Target:** ${targetLength} words (range: ${template.lengthGuidelines.min}-${template.lengthGuidelines.max} words)

${params.audience ? `**Target Audience:** ${params.audience}\n` : ''}
${params.additionalInstructions ? `**Additional Instructions:** ${params.additionalInstructions}\n` : ''}

## Your Task

Write a ${template.name.toLowerCase()} on "${params.topic}" that:
1. Matches the voice characteristics and style patterns described above
2. Incorporates relevant knowledge from the provided notes
3. Follows the structural template for ${template.name}
4. Sounds authentic and natural, as if the user wrote it themselves
5. Meets the length target of approximately ${targetLength} words

**Critical:** The content must sound like it was written by the user, not by an AI. Use their patterns, vocabulary, and voice characteristics consistently throughout.

Generate the content now:`;
}
