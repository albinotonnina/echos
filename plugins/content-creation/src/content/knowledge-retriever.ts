import type { PluginContext } from '@echos/core';

export interface RelevantNote {
  id: string;
  title: string;
  content: string;
  excerpt?: string;
  score: number;
}

export interface RetrievalOptions {
  /** Maximum number of notes to retrieve */
  limit?: number;
  /** Only use notes created/updated in the last N days */
  recentDays?: number;
  /** Minimum relevance score (0-1) */
  minScore?: number;
}

/**
 * Retrieve relevant knowledge from notes using hybrid search (semantic + keyword)
 * This provides context for content generation (RAG - Retrieval Augmented Generation)
 */
export async function retrieveRelevantKnowledge(
  topic: string,
  context: PluginContext,
  options: RetrievalOptions = {},
): Promise<RelevantNote[]> {
  const logger = context.logger.child({ function: 'retrieveRelevantKnowledge' });
  const limit = options.limit ?? 15;
  const minScore = options.minScore ?? 0.3;

  try {
    // Generate embedding for the topic
    logger.debug({ topic }, 'Generating embedding for topic');
    const topicVector = await context.generateEmbedding(topic);

    // Perform vector search
    logger.debug({ limit: limit * 2 }, 'Performing vector search');
    const vectorResults = await context.vectorDb.search(topicVector, limit * 2);

    // Also perform keyword/FTS search
    logger.debug({ query: topic, limit: limit * 2 }, 'Performing FTS search');
    const ftsResults = context.sqlite.searchFts(topic, { limit: limit * 2 });

    // Combine results using reciprocal rank fusion (RRF)
    const k = 60; // RRF constant
    const scores = new Map<string, number>();

    // Add FTS scores
    ftsResults.forEach((row, idx) => {
      const rank = idx + 1;
      scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (k + rank));
    });

    // Add vector scores
    vectorResults.forEach((result, idx) => {
      const rank = idx + 1;
      scores.set(result.id, (scores.get(result.id) ?? 0) + 1 / (k + rank));
    });

    // Sort by combined score
    const rankedIds = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    logger.debug({ totalResults: rankedIds.length }, 'Combined search results');

    // Retrieve and format notes
    const relevantNotes: RelevantNote[] = [];
    const cutoffDate = options.recentDays
      ? new Date(Date.now() - options.recentDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    for (const [noteId, score] of rankedIds) {
      // Normalize score to 0-1 range (RRF scores are typically < 1 already)
      const normalizedScore = Math.min(score * 10, 1);

      if (normalizedScore < minScore) {
        continue;
      }

      const noteRow = context.sqlite.getNote(noteId);
      if (!noteRow) continue;

      // Filter by recency if specified
      if (cutoffDate && noteRow.updated < cutoffDate) {
        continue;
      }

      // Read full note from markdown
      let fullContent = noteRow.content;
      try {
        const note = context.markdown.read(noteRow.filePath);
        if (note) {
          fullContent = note.content;
        }
      } catch (error) {
        logger.warn({ noteId, error }, 'Failed to read note from markdown, using database content');
      }

      // Create excerpt if content is long (> 1000 chars)
      let excerpt: string | undefined = undefined;
      if (fullContent.length > 1000) {
        // Try to find the most relevant excerpt by looking for topic keywords
        const lowerTopic = topic.toLowerCase();
        const topicWords = lowerTopic.split(/\s+/).filter((w) => w.length > 3);

        // Find paragraphs containing topic keywords
        const paragraphs = fullContent.split(/\n\n+/);
        const scoredParas = paragraphs
          .map((para) => {
            const lowerPara = para.toLowerCase();
            const matches = topicWords.filter((word) => lowerPara.includes(word)).length;
            return { para, matches };
          })
          .filter((sp) => sp.matches > 0)
          .sort((a, b) => b.matches - a.matches);

        if (scoredParas.length > 0) {
          // Take top 2-3 most relevant paragraphs
          excerpt = scoredParas
            .slice(0, 3)
            .map((sp) => sp.para)
            .join('\n\n');
          if (excerpt.length > 1500) {
            excerpt = excerpt.slice(0, 1500) + '...';
          }
        } else {
          // Fallback to first 1000 chars
          excerpt = fullContent.slice(0, 1000) + '...';
        }
      }

      const noteToAdd: RelevantNote = {
        id: noteId,
        title: noteRow.title,
        content: fullContent,
        score: normalizedScore,
      };

      if (excerpt !== undefined) {
        noteToAdd.excerpt = excerpt;
      }

      relevantNotes.push(noteToAdd);
    }

    logger.info({ count: relevantNotes.length, topic }, 'Retrieved relevant knowledge');

    return relevantNotes;
  } catch (error) {
    logger.error({ error, topic }, 'Failed to retrieve relevant knowledge');
    throw new Error(
      `Failed to retrieve knowledge: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
