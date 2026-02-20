import type { Logger } from 'pino';
import type { LLMStyleAnalysis } from '../types.js';

/**
 * Analyze writing style using LLM to extract voice characteristics, patterns, and structure
 */
export async function analyzeLinguisticStyle(
  texts: string[],
  anthropicApiKey: string,
  logger: Logger,
): Promise<LLMStyleAnalysis> {
  if (texts.length === 0) {
    throw new Error('Cannot analyze style: no text samples provided');
  }

  // Combine sample texts with clear separation
  const combinedTexts = texts.map((text, idx) => `=== Sample ${idx + 1} ===\n${text}`).join('\n\n');

  const analysisPrompt = `You are a writing style analyst. Analyze the following writing samples and extract detailed characteristics about the author's voice, patterns, and style.

Writing samples:
${combinedTexts}

Please analyze these samples and provide a detailed JSON response with the following structure:

{
  "voiceCharacteristics": {
    "toneDescriptors": ["<list 3-5 adjectives describing tone, e.g., direct, conversational, technical>"],
    "formalityLevel": "<one of: casual, professional, academic>",
    "emotionalRange": "<one of: reserved, expressive, neutral>",
    "perspective": "<one of: first-person, third-person, mixed>"
  },
  "patterns": {
    "sentenceStarters": ["<5-10 common ways this author starts sentences>"],
    "transitions": ["<5-10 transition phrases used between ideas>"],
    "emphasisPhrases": ["<phrases used to emphasize points>"],
    "hedges": ["<qualifying/hedging words like 'generally', 'usually'>"],
    "closingPhrases": ["<phrases used to conclude thoughts>"]
  },
  "structure": {
    "prefersLists": <boolean>,
    "usesMetaphors": <boolean>,
    "paragraphStyle": "<one of: short, medium, long>",
    "storytellingApproach": "<one of: chronological, thematic, problem-solution>"
  },
  "vocabulary": {
    "signatureWords": ["<10-15 distinctive words frequently used>"],
    "avoidedWords": ["<words that are notably absent or avoided>"],
    "technicalTerms": {<technical/domain terms with rough frequency counts>},
    "jargonLevel": "<one of: minimal, moderate, heavy>"
  },
  "sampleParagraphs": ["<5-8 representative paragraphs that best exemplify this writing style>"]
}

Be specific and evidence-based. Look for:
- Unique patterns that distinguish this voice
- Consistent linguistic choices
- Structural preferences
- Vocabulary quirks and preferences
- Representative examples that capture the authentic voice

Return ONLY valid JSON, no other text.`;

  try {
    logger.debug(
      { sampleCount: texts.length, totalLength: combinedTexts.length },
      'Analyzing linguistic style with LLM',
    );

    // Make direct API call to Anthropic
    let response: Response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 4000,
          messages: [
            {
              role: 'user',
              content: analysisPrompt,
            },
          ],
        }),
      });
    } catch (fetchError) {
      logger.error({ fetchError }, 'Network request to Anthropic API failed');
      throw new Error(
        `Failed to connect to Anthropic API: ${fetchError instanceof Error ? fetchError.message : 'Network error'}. Please check your internet connection.`,
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { status: response.status, error: errorText },
        'Anthropic API request failed',
      );

      // Provide specific error messages based on status code
      if (response.status === 401) {
        throw new Error('Anthropic API authentication failed. Please check your API key configuration.');
      } else if (response.status === 429) {
        throw new Error('Anthropic API rate limit exceeded. Please try again in a few moments.');
      } else if (response.status >= 500) {
        throw new Error(`Anthropic API server error (${response.status}). This is a temporary issue - please try again later.`);
      } else {
        throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
      }
    }

    const result = await response.json() as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    // Parse JSON response
    const content = result.content
      .map((block) => (block.type === 'text' ? block.text ?? '' : ''))
      .join('');

    if (!content || content.trim().length === 0) {
      logger.error({ result }, 'Anthropic API returned empty content');
      throw new Error('Anthropic API returned empty response. Please try again.');
    }

    // Extract JSON from potential markdown code blocks
    let jsonText = content.trim();
    if (jsonText.startsWith('```')) {
      const match = jsonText.match(/```(?:json)?\n([\s\S]*?)\n```/);
      if (match && match[1]) {
        jsonText = match[1];
      } else {
        logger.error({ content }, 'Failed to extract JSON from markdown code block');
        throw new Error('Failed to parse LLM response: JSON was wrapped in markdown but extraction failed.');
      }
    }

    let analysis: LLMStyleAnalysis;
    try {
      analysis = JSON.parse(jsonText) as LLMStyleAnalysis;
    } catch (parseError) {
      logger.error(
        { jsonText: jsonText.substring(0, 500), parseError },
        'Failed to parse JSON response from LLM',
      );
      throw new Error(
        `Failed to parse LLM response as JSON: ${parseError instanceof Error ? parseError.message : 'Invalid JSON format'}. This is likely a temporary issue - please try again.`,
      );
    }

    logger.info(
      {
        toneDescriptors: analysis.voiceCharacteristics.toneDescriptors,
        formalityLevel: analysis.voiceCharacteristics.formalityLevel,
        sampleParagraphCount: analysis.sampleParagraphs.length,
      },
      'LLM style analysis complete',
    );

    return analysis;
  } catch (error) {
    logger.error({ error }, 'Failed to analyze linguistic style with LLM');
    throw new Error(
      `LLM style analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
