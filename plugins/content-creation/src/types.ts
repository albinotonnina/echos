import type { StyleProfile } from '@echos/core';

/**
 * Voice characteristics extracted by LLM analysis
 */
export interface VoiceCharacteristics {
  /** Descriptors of tone (e.g., "direct", "technical", "conversational") */
  toneDescriptors: string[];
  /** Overall formality level */
  formalityLevel: 'casual' | 'professional' | 'academic';
  /** Emotional expression range */
  emotionalRange: 'reserved' | 'expressive' | 'neutral';
  /** Narrative perspective preference */
  perspective: 'first-person' | 'third-person' | 'mixed';
}

/**
 * Writing patterns identified by LLM
 */
export interface WritingPatterns {
  /** Common sentence starters */
  sentenceStarters: string[];
  /** Transition phrases between ideas */
  transitions: string[];
  /** Phrases used for emphasis */
  emphasisPhrases: string[];
  /** Hedging/qualifying words */
  hedges: string[];
  /** Common closing phrases */
  closingPhrases: string[];
}

/**
 * Structural preferences in writing
 */
export interface StructurePreferences {
  /** Preference for bulleted/numbered lists */
  prefersLists: boolean;
  /** Uses metaphors and analogies */
  usesMetaphors: boolean;
  /** Typical paragraph length */
  paragraphStyle: 'short' | 'medium' | 'long';
  /** Approach to storytelling */
  storytellingApproach: 'chronological' | 'thematic' | 'problem-solution';
}

/**
 * Vocabulary characteristics
 */
export interface VocabularyProfile {
  /** Distinctive words frequently used */
  signatureWords: string[];
  /** Words avoided or never used */
  avoidedWords: string[];
  /** Technical/domain-specific terms with frequency */
  technicalTerms: Record<string, number>;
  /** Overall jargon usage level */
  jargonLevel: 'minimal' | 'moderate' | 'heavy';
}

/**
 * Complete LLM-derived style analysis
 */
export interface LLMStyleAnalysis {
  voiceCharacteristics: VoiceCharacteristics;
  patterns: WritingPatterns;
  structure: StructurePreferences;
  vocabulary: VocabularyProfile;
  /** Representative paragraphs for few-shot examples */
  sampleParagraphs: string[];
}

/**
 * Enhanced style profile combining statistical and LLM analysis
 */
export interface EnhancedStyleProfile extends StyleProfile {
  /** LLM-derived voice characteristics */
  voiceCharacteristics: VoiceCharacteristics;
  /** Writing patterns identified by LLM */
  patterns: WritingPatterns;
  /** Structural preferences */
  structure: StructurePreferences;
  /** Vocabulary characteristics */
  vocabulary: VocabularyProfile;
  /** Representative sample paragraphs for few-shot learning */
  sampleParagraphs: string[];
  /** Profile version for future migrations */
  version: number;
  /** Analysis method used */
  analysisMethod: 'statistical' | 'hybrid' | 'llm-only';
}

/**
 * Content type for generation
 */
export type ContentType = 'blog_post' | 'article' | 'thread' | 'email' | 'essay' | 'tutorial';

/**
 * Content generation parameters
 */
export interface ContentGenerationParams {
  /** Topic or subject to write about */
  topic: string;
  /** Type of content to generate */
  contentType: ContentType;
  /** Target length in words (optional) */
  targetLength?: number;
  /** Use only recent notes for context (optional) */
  useRecentNotes?: boolean;
  /** Target audience (optional) */
  audience?: string;
  /** Additional instructions (optional) */
  additionalInstructions?: string;
}

/**
 * Generated content result
 */
export interface GeneratedContent {
  /** The generated content */
  content: string;
  /** Content type */
  contentType: ContentType;
  /** Topic */
  topic: string;
  /** Tokens used in generation */
  tokensUsed?: {
    input: number;
    output: number;
  };
  /** Note IDs used for context */
  sourceNotes: string[];
  /** Generation timestamp */
  generatedAt: string;
}

/**
 * Content template structure
 */
export interface ContentTemplate {
  /** Template name */
  name: string;
  /** Description of this content type */
  description: string;
  /** Structural sections/elements */
  structure: string[];
  /** Style-specific guidelines */
  styleGuide: string;
  /** Recommended length range */
  lengthGuidelines: {
    min: number;
    max: number;
    optimal: number;
  };
}

/**
 * Style analysis options
 */
export interface StyleAnalysisOptions {
  /** Force re-analysis even if profile exists */
  forceReanalysis?: boolean;
  /** Minimum number of voice examples required */
  minExamples?: number;
}
