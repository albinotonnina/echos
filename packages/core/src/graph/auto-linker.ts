import type { SqliteStorage, NoteRow } from '../storage/sqlite.js';
import type { VectorStorage } from '../storage/vectordb.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LinkSuggestion {
  targetId: string;
  targetTitle: string;
  /** Cosine-similarity-derived score in [0, 1]. */
  similarity: number;
  /** Short human-readable reason (shared tags, category, or semantic similarity). */
  reason: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Notes with a similarity score below this threshold are excluded by default. */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.82;

const DEFAULT_LIMIT = 5;

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Find semantically similar notes that are not yet linked to `noteId`.
 *
 * The note's embedding is generated on the fly so the caller does not need to
 * store or cache vectors separately. Already-linked notes and notes that share
 * the same `sourceUrl` (split content) are excluded.
 */
export async function suggestLinks(
  noteId: string,
  sqlite: SqliteStorage,
  vectorStore: VectorStorage,
  generateEmbedding: (text: string) => Promise<number[]>,
  limit?: number,
  similarityThreshold?: number,
): Promise<LinkSuggestion[]> {
  const note = sqlite.getNote(noteId);
  if (!note) return [];

  const threshold = similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const maxResults = limit ?? DEFAULT_LIMIT;

  // Fetch extra candidates to allow filtering after deduplication / exclusions.
  const fetchLimit = maxResults * 4;

  const embedText = `${note.title}\n\n${note.content}`;
  const vector = await generateEmbedding(embedText);

  const results = await vectorStore.search(vector, fetchLimit);

  // Build the set of already-linked note IDs (bidirectional links are stored on
  // both sides, so checking the source note's link list is sufficient).
  const alreadyLinked = new Set<string>(
    note.links ? note.links.split(',').map((l) => l.trim()).filter(Boolean) : [],
  );
  alreadyLinked.add(noteId); // never suggest the note itself

  const noteTags = new Set<string>(
    note.tags ? note.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
  );

  const suggestions: LinkSuggestion[] = [];

  for (const result of results) {
    if (result.score < threshold) continue; // LanceDB returns highest scores first
    if (alreadyLinked.has(result.id)) continue;

    const targetRow = sqlite.getNote(result.id);
    if (!targetRow) continue;

    // Skip notes that share the same source URL (avoid linking split content
    // from the same article / video back to each other).
    if (note.sourceUrl && targetRow.sourceUrl && note.sourceUrl === targetRow.sourceUrl) continue;

    suggestions.push({
      targetId: result.id,
      targetTitle: result.title,
      similarity: result.score,
      reason: deriveReason(note, noteTags, targetRow),
    });

    if (suggestions.length >= maxResults) break;
  }

  return suggestions;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a short human-readable reason from overlapping tags / category.
 * Falls back to a generic "semantically similar content" message.
 */
function deriveReason(note: NoteRow, noteTags: Set<string>, target: NoteRow): string {
  const parts: string[] = [];

  const targetTags = target.tags
    ? target.tags.split(',').map((t) => t.trim()).filter(Boolean)
    : [];
  const sharedTags = targetTags.filter((t) => noteTags.has(t));

  if (sharedTags.length > 0) {
    parts.push(`shared tags: ${sharedTags.slice(0, 3).join(', ')}`);
  }

  if (note.category && target.category && note.category === target.category) {
    parts.push(`same category: ${note.category}`);
  }

  if (parts.length === 0) {
    parts.push('semantically similar content');
  }

  return parts.join('; ');
}
