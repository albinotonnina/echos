import { YoutubeTranscript } from 'youtube-transcript';
import type { Logger } from 'pino';
import { validateUrl, sanitizeHtml } from '@echos/shared';
import type { ProcessedContent } from '@echos/shared';

const YOUTUBE_REGEX = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/;

export function extractVideoId(url: string): string | null {
  const match = YOUTUBE_REGEX.exec(url);
  return match?.[1] ?? null;
}

export async function processYoutube(url: string, logger: Logger): Promise<ProcessedContent> {
  const validatedUrl = validateUrl(url);
  const videoId = extractVideoId(validatedUrl);

  if (!videoId) {
    throw new Error('Invalid YouTube URL');
  }

  logger.info({ videoId }, 'Processing YouTube video');

  // Fetch transcript
  let transcript: string;
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    transcript = segments.map((s) => s.text).join(' ');
  } catch (err) {
    logger.warn({ err, videoId }, 'Transcript fetch failed');
    throw new Error('Could not fetch YouTube transcript. Video may not have captions.');
  }

  // Clean transcript
  const content = sanitizeHtml(transcript);

  // Fetch video title from oEmbed
  let title = `YouTube Video ${videoId}`;
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(validatedUrl)}&format=json`;
    const response = await fetch(oembedUrl, { signal: AbortSignal.timeout(10000) });
    if (response.ok) {
      const data = (await response.json()) as { title?: string; author_name?: string };
      if (data.title) title = sanitizeHtml(data.title);
    }
  } catch {
    // Non-fatal, use default title
  }

  logger.info({ title, transcriptLength: content.length }, 'YouTube video processed');

  return {
    title,
    content,
    metadata: {
      type: 'youtube',
      sourceUrl: validatedUrl,
    },
    embedText: `${title}\n\n${content.slice(0, 3000)}`,
  };
}
