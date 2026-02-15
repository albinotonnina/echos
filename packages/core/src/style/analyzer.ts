import type { Logger } from 'pino';

export interface StyleProfile {
  avgSentenceLength: number;
  avgParagraphLength: number;
  vocabularyRichness: number;
  commonPhrases: string[];
  tone: string;
  sampleCount: number;
  lastUpdated: string;
}

export function analyzeStyle(texts: string[], logger: Logger): StyleProfile {
  if (texts.length === 0) {
    return {
      avgSentenceLength: 0,
      avgParagraphLength: 0,
      vocabularyRichness: 0,
      commonPhrases: [],
      tone: 'neutral',
      sampleCount: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  const allText = texts.join('\n\n');

  // Sentence analysis
  const sentences = allText.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const avgSentenceLength =
    sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) / sentences.length;

  // Paragraph analysis
  const paragraphs = allText.split(/\n\n+/).filter((p) => p.trim().length > 0);
  const avgParagraphLength =
    paragraphs.reduce((sum, p) => sum + p.trim().split(/\s+/).length, 0) / paragraphs.length;

  // Vocabulary richness (unique words / total words)
  const words = allText.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const uniqueWords = new Set(words);
  const vocabularyRichness = words.length > 0 ? uniqueWords.size / words.length : 0;

  // Common phrases (bigrams)
  const bigrams = new Map<string, number>();
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }
  const commonPhrases = Array.from(bigrams.entries())
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([phrase]) => phrase);

  logger.debug(
    { sampleCount: texts.length, sentenceCount: sentences.length },
    'Style analysis complete',
  );

  return {
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    avgParagraphLength: Math.round(avgParagraphLength * 10) / 10,
    vocabularyRichness: Math.round(vocabularyRichness * 1000) / 1000,
    commonPhrases,
    tone: avgSentenceLength < 12 ? 'concise' : avgSentenceLength < 20 ? 'moderate' : 'verbose',
    sampleCount: texts.length,
    lastUpdated: new Date().toISOString(),
  };
}
