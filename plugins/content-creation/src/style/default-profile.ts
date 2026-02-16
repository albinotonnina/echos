import type { EnhancedStyleProfile } from '../types.js';

/**
 * Default voice profile for immediate content generation
 *
 * This profile provides a balanced, professional yet approachable writing style
 * that works well for most content types. Users can override this by running
 * analyze_my_style with their own curated voice examples.
 */
export const DEFAULT_PROFILE: EnhancedStyleProfile = {
  // Statistical baseline
  avgSentenceLength: 18,
  avgParagraphLength: 75,
  vocabularyRichness: 0.65,
  commonPhrases: [
    'in other words',
    'for example',
    'on the other hand',
    'keep in mind',
    'it turns out',
  ],
  tone: 'moderate',
  sampleCount: 0,
  lastUpdated: new Date().toISOString(),

  // Voice characteristics - professional yet conversational
  voiceCharacteristics: {
    toneDescriptors: ['clear', 'direct', 'professional', 'approachable'],
    formalityLevel: 'professional',
    emotionalRange: 'neutral',
    perspective: 'mixed',
  },

  // Writing patterns - balanced and structured
  patterns: {
    sentenceStarters: [
      'Consider',
      'Let\'s look at',
      'You might',
      'This means',
      'Here\'s the thing',
      'The key point is',
      'What this tells us',
      'In practice',
    ],
    transitions: [
      'However',
      'Additionally',
      'In other words',
      'For instance',
      'That said',
      'More importantly',
      'As a result',
      'On the flip side',
    ],
    emphasisPhrases: [
      'This is important',
      'Key takeaway',
      'Worth noting',
      'The crucial part',
    ],
    hedges: [
      'generally',
      'typically',
      'often',
      'in most cases',
      'usually',
    ],
    closingPhrases: [
      'In summary',
      'The bottom line',
      'To wrap up',
      'Key takeaways',
      'Moving forward',
    ],
  },

  // Structure preferences - clean and scannable
  structure: {
    prefersLists: true,
    usesMetaphors: false,
    paragraphStyle: 'medium',
    storytellingApproach: 'problem-solution',
  },

  // Vocabulary - accessible professional
  vocabulary: {
    signatureWords: [
      'approach',
      'consider',
      'effective',
      'practical',
      'solution',
      'example',
      'understand',
      'important',
    ],
    avoidedWords: [
      'utilize',
      'leverage',
      'synergy',
      'paradigm',
      'disrupt',
    ],
    technicalTerms: {},
    jargonLevel: 'minimal',
  },

  // Sample paragraphs - demonstrate the default style
  sampleParagraphs: [
    'When you\'re learning something new, it helps to start with the fundamentals. Think of it like building a house - you need a solid foundation before you can add the walls and roof. The same principle applies here. By understanding the core concepts first, you\'ll have an easier time grasping the more advanced topics later.',

    'Here\'s what makes this approach effective: it breaks down complex problems into manageable pieces. Instead of trying to tackle everything at once, you focus on one aspect at a time. This not only reduces overwhelm but also helps you build confidence as you make progress.',

    'Consider a practical example. Let\'s say you\'re working on a project with a tight deadline. Rather than panicking about all the work ahead, you create a clear plan with specific milestones. Each milestone becomes a small win, keeping you motivated and on track. This is the power of systematic thinking.',
  ],

  // Metadata
  version: 1,
  analysisMethod: 'statistical',
};

/**
 * Check if a profile is the default profile (never analyzed)
 */
export function isDefaultProfile(profile: EnhancedStyleProfile): boolean {
  return profile.sampleCount === 0 && profile.analysisMethod === 'statistical';
}
