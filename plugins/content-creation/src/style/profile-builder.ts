import type { StyleProfile } from '@echos/core';
import type { EnhancedStyleProfile, LLMStyleAnalysis } from '../types.js';

/**
 * Build an enhanced style profile by merging statistical and LLM analysis
 */
export function buildEnhancedProfile(
  statistical: StyleProfile,
  llmAnalysis: LLMStyleAnalysis,
): EnhancedStyleProfile {
  return {
    // Statistical analysis from core
    avgSentenceLength: statistical.avgSentenceLength,
    avgParagraphLength: statistical.avgParagraphLength,
    vocabularyRichness: statistical.vocabularyRichness,
    commonPhrases: statistical.commonPhrases,
    tone: statistical.tone,
    sampleCount: statistical.sampleCount,
    lastUpdated: statistical.lastUpdated,

    // LLM-derived insights
    voiceCharacteristics: llmAnalysis.voiceCharacteristics,
    patterns: llmAnalysis.patterns,
    structure: llmAnalysis.structure,
    vocabulary: llmAnalysis.vocabulary,
    sampleParagraphs: llmAnalysis.sampleParagraphs,

    // Metadata
    version: 1,
    analysisMethod: 'hybrid',
  };
}

/**
 * Select the best sample paragraphs from texts for few-shot examples
 * Aims for variety and representativeness
 */
export function selectSampleParagraphs(texts: string[], targetCount: number = 6): string[] {
  const allParagraphs: string[] = [];

  // Extract all paragraphs from all texts
  for (const text of texts) {
    const paragraphs = text
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => {
        // Filter: must be substantial (50+ words, 200+ chars)
        const wordCount = p.split(/\s+/).length;
        return wordCount >= 50 && p.length >= 200;
      });
    allParagraphs.push(...paragraphs);
  }

  if (allParagraphs.length === 0) {
    return [];
  }

  // If we have fewer paragraphs than target, return all
  if (allParagraphs.length <= targetCount) {
    return allParagraphs;
  }

  // Select evenly distributed samples
  const step = Math.floor(allParagraphs.length / targetCount);
  const selected: string[] = [];

  for (let i = 0; i < targetCount; i++) {
    const idx = Math.min(i * step, allParagraphs.length - 1);
    const para = allParagraphs[idx];
    if (para) {
      selected.push(para);
    }
  }

  return selected;
}
