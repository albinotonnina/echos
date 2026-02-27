import ytdl from '@distube/ytdl-core';
import OpenAI from 'openai';
import { createWriteStream } from 'fs';
import { unlink, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import type { Logger } from 'pino';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { YouTubeTranscriptApi, WebshareProxyConfig } from 'youtube-transcript-api-js';
import type { ProxyConfig as TranscriptProxyConfig } from 'youtube-transcript-api-js';
import { validateUrl, sanitizeHtml, ProcessingError, ExternalServiceError } from '@echos/shared';
import type { ProcessedContent } from '@echos/shared';

export type ProxyConfig = { username: string; password: string } | undefined;

function createProxyAgent(proxyConfig: ProxyConfig): HttpsProxyAgent<string> | undefined {
  if (!proxyConfig) return undefined;
  // .env stores the base Webshare username (without -rotate).
  // Append -rotate so the proxy rotates IPs on each request.
  const proxyUrl = `http://${proxyConfig.username}-rotate:${proxyConfig.password}@p.webshare.io:80`;
  return new HttpsProxyAgent(proxyUrl);
}

function createTranscriptProxyConfig(proxyConfig: ProxyConfig): TranscriptProxyConfig | undefined {
  if (!proxyConfig) return undefined;
  // WebshareProxyConfig appends -rotate to the username automatically
  // and provides retriesWhenBlocked + preventKeepingConnectionsAlive.
  return new WebshareProxyConfig(proxyConfig.username, proxyConfig.password);
}

const WHISPER_MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25MB (OpenAI limit)
const DOWNLOAD_TIMEOUT_MS = 300000; // 5 minutes for audio download
const MAX_TRANSCRIPT_LENGTH = 500000; // ~500k characters
const TRANSCRIPT_TIMEOUT_MS = 30000; // 30 seconds for transcript fetch
const YTDL_CACHE_DIR = join(process.cwd(), 'data', 'cache', 'ytdl');

/**
 * Ensure ytdl cache directory exists
 */
async function ensureCacheDir(): Promise<void> {
  if (!existsSync(YTDL_CACHE_DIR)) {
    await mkdir(YTDL_CACHE_DIR, { recursive: true });
  }
}

/**
 * Execute ytdl operation with proper cache directory
 * ytdl-core saves player scripts to process.cwd(), so we temporarily change it
 */
async function withYtdlCache<T>(operation: () => Promise<T>): Promise<T> {
  await ensureCacheDir();
  const originalCwd = process.cwd();
  try {
    process.chdir(YTDL_CACHE_DIR);
    return await operation();
  } finally {
    process.chdir(originalCwd);
  }
}

/**
 * Execute ytdl stream operation with proper cache directory (synchronous start)
 */
function withYtdlCacheSync<T>(operation: () => T): T {
  // Ensure cache dir exists synchronously
  if (!existsSync(YTDL_CACHE_DIR)) {
    require('fs').mkdirSync(YTDL_CACHE_DIR, { recursive: true });
  }
  const originalCwd = process.cwd();
  try {
    process.chdir(YTDL_CACHE_DIR);
    return operation();
  } finally {
    process.chdir(originalCwd);
  }
}

/**
 * Extract YouTube video ID from URL
 */
export function extractVideoId(url: string): string {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  throw new ProcessingError('Could not extract YouTube video ID from URL');
}

/**
 * Fetch transcript using youtube-transcript-api-js (pure JS, no Python dependency)
 */
async function fetchYoutubeTranscript(videoId: string, logger: Logger, proxyConfig?: ProxyConfig): Promise<string> {
  logger.debug({ videoId, hasProxy: !!proxyConfig }, 'Fetching YouTube transcript');

  const transcriptProxyConfig = createTranscriptProxyConfig(proxyConfig);
  const api = transcriptProxyConfig
    ? new YouTubeTranscriptApi(transcriptProxyConfig)
    : new YouTubeTranscriptApi();

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    setTimeout(() => {
      reject(new ProcessingError('Transcript fetch timeout', true));
    }, TRANSCRIPT_TIMEOUT_MS);
  });

  try {
    const transcriptList = await Promise.race([
      api.list(videoId),
      timeoutPromise,
    ]);

    // Try to find transcript in order: manual en, generated en, any available
    let fetchedTranscript;
    try {
      const transcript = transcriptList.findTranscript(['en']);
      fetchedTranscript = await transcript.fetch();
    } catch {
      try {
        const transcript = transcriptList.findGeneratedTranscript(['en']);
        fetchedTranscript = await transcript.fetch();
      } catch {
        // Get any available transcript
        const allTranscripts = [...transcriptList];
        if (allTranscripts.length === 0) {
          throw new ProcessingError('No transcript available', true);
        }
        fetchedTranscript = await allTranscripts[0]!.fetch();
      }
    }

    const text = fetchedTranscript.snippets.map((s) => s.text).join(' ');

    if (!text || text.length === 0) {
      throw new ProcessingError('No transcript data returned', true);
    }

    if (text.length > MAX_TRANSCRIPT_LENGTH) {
      throw new ProcessingError(
        `Transcript too long: ${text.length} characters`,
        false
      );
    }

    logger.info(
      { videoId, transcriptLength: text.length, segments: fetchedTranscript.snippets.length },
      'YouTube transcript fetched successfully'
    );
    return text;
  } catch (error) {
    if (error instanceof ProcessingError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorName = error instanceof Error ? error.constructor.name : typeof error;
    logger.warn(
      { videoId, errorName, error: errorMessage, hasProxy: !!proxyConfig },
      'YouTube transcript unavailable'
    );
    throw new ProcessingError(`YouTube transcript unavailable [${errorName}]: ${errorMessage}`, true);
  }
}

/**
 * Download audio from YouTube video
 */
async function downloadAudio(videoId: string, logger: Logger, proxyConfig?: ProxyConfig): Promise<string> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const tempFilePath = join(tmpdir(), `youtube_${videoId}_${Date.now()}.mp3`);

  logger.debug({ videoId, tempFilePath, hasProxy: !!proxyConfig }, 'Downloading YouTube audio');

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new ProcessingError('Audio download timeout', false));
    }, DOWNLOAD_TIMEOUT_MS);

    let downloadedBytes = 0;

    try {
      const agent = createProxyAgent(proxyConfig);
      const options = {
        quality: 'lowestaudio',
        filter: 'audioonly',
        requestOptions: {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          ...(agent ? { agent } : {}),
        },
      } as const;

      const stream = withYtdlCacheSync(() => ytdl(url, options));

      stream.on('progress', (_chunkLength, downloaded, _total) => {
        downloadedBytes = downloaded;

        if (downloadedBytes > WHISPER_MAX_SIZE_BYTES) {
          stream.destroy();
          reject(
            new ProcessingError(
              `Audio file too large: ${(downloadedBytes / 1024 / 1024).toFixed(2)}MB`,
              false
            )
          );
        }
      });

      stream.on('error', (error) => {
        clearTimeout(timeout);
        reject(new ExternalServiceError('YouTube', `Failed to download audio: ${error.message}`));
      });

      const writeStream = createWriteStream(tempFilePath);

      writeStream.on('error', (error) => {
        clearTimeout(timeout);
        reject(new ExternalServiceError('YouTube', `Failed to write audio file: ${error.message}`));
      });

      writeStream.on('finish', () => {
        clearTimeout(timeout);
        logger.debug(
          { videoId, tempFilePath, sizeBytes: downloadedBytes },
          'Audio download complete'
        );
        resolve(tempFilePath);
      });

      stream.pipe(writeStream);
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error) {
        reject(new ExternalServiceError('YouTube', `Audio download failed: ${error.message}`));
      } else {
        reject(new ExternalServiceError('YouTube', 'Unknown audio download error'));
      }
    }
  });
}

/**
 * Transcribe audio using OpenAI Whisper
 */
async function transcribeWithWhisper(
  audioFilePath: string,
  videoId: string,
  openaiApiKey: string,
  logger: Logger
): Promise<string> {
  logger.debug({ videoId, audioFilePath }, 'Transcribing with Whisper');

  const openai = new OpenAI({ apiKey: openaiApiKey });

  try {
    const { createReadStream } = await import('fs');
    const audioStream = createReadStream(audioFilePath) as unknown as File;

    const transcription = await openai.audio.transcriptions.create({
      file: audioStream,
      model: 'whisper-1',
      response_format: 'text',
    });

    if (!transcription || typeof transcription !== 'string') {
      throw new ProcessingError('Empty transcription returned from Whisper', false);
    }

    if (transcription.length > MAX_TRANSCRIPT_LENGTH) {
      throw new ProcessingError(
        `Transcription too long: ${transcription.length} characters`,
        false
      );
    }

    logger.info(
      { videoId, transcriptionLength: transcription.length },
      'Whisper transcription complete'
    );

    return transcription;
  } catch (error) {
    if (error instanceof ProcessingError) {
      throw error;
    }

    if (error instanceof Error) {
      throw new ExternalServiceError('OpenAI Whisper', error.message);
    }

    throw new ExternalServiceError('OpenAI Whisper', 'Unknown transcription error');
  }
}

/**
 * Get video metadata via YouTube oEmbed API (simple, reliable, no library dependency)
 * Falls back to ytdl-core if oEmbed fails, then to dummy title.
 */
async function getVideoMetadata(
  videoId: string,
  logger: Logger,
  proxyConfig?: ProxyConfig
): Promise<{ title: string; channel?: string; duration?: number; publishedDate?: string }> {
  // Primary: YouTube oEmbed API — simple HTTP call, very reliable
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const response = await fetch(oembedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json() as { title?: string; author_name?: string };
      const title = data.title || 'Untitled';
      const channel = data.author_name || undefined;
      logger.info({ videoId, title, channel }, 'Metadata fetched via oEmbed');
      return {
        title,
        ...(channel ? { channel } : {}),
      };
    }

    logger.warn({ videoId, status: response.status }, 'oEmbed API returned non-OK status');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.warn({ videoId, error: errorMessage }, 'oEmbed metadata fetch failed');
  }

  // Fallback: ytdl-core (less reliable but can provide duration/publishDate)
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const agent = createProxyAgent(proxyConfig);
    const info = await withYtdlCache(async () => ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        ...(agent ? { agent } : {}),
      },
    }));

    const title = info.videoDetails.title || 'Untitled';
    const channel = info.videoDetails.author.name;
    const parsedDuration = parseInt(info.videoDetails.lengthSeconds, 10);
    logger.info({ videoId, title, channel }, 'Metadata fetched via ytdl-core fallback');

    return {
      title,
      ...(channel ? { channel } : {}),
      ...(Number.isFinite(parsedDuration) ? { duration: parsedDuration } : {}),
      ...(info.videoDetails.publishDate ? { publishedDate: info.videoDetails.publishDate } : {}),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.warn({ videoId, error: errorMessage }, 'ytdl-core metadata also failed, using dummy title');
    return { title: `YouTube Video ${videoId}` };
  }
}

/**
 * Process a YouTube video URL
 */
export async function processYoutube(
  url: string,
  logger: Logger,
  openaiApiKey?: string,
  proxyConfig?: ProxyConfig
): Promise<ProcessedContent> {
  logger.debug({ url, hasProxy: !!proxyConfig }, 'Processing YouTube video');

  const validatedUrl = validateUrl(url);
  const videoId = extractVideoId(validatedUrl);

  logger.debug({ videoId }, 'Video ID extracted');

  const metadata = await getVideoMetadata(videoId, logger, proxyConfig);

  let transcript: string;
  let transcriptSource: 'youtube' | 'whisper';
  let audioFilePath: string | null = null;

  try {
    transcript = await fetchYoutubeTranscript(videoId, logger, proxyConfig);
    transcriptSource = 'youtube';

    logger.info({ videoId, source: 'youtube' }, 'Transcript obtained from YouTube');
  } catch (transcriptError) {
    const errorMessage =
      transcriptError instanceof Error ? transcriptError.message : 'Unknown error';
    logger.warn(
      { videoId, error: errorMessage },
      'YouTube transcript unavailable, falling back to Whisper'
    );

    if (!openaiApiKey) {
      throw new ProcessingError(
        'YouTube transcript unavailable and OpenAI API key not configured. Please set OPENAI_API_KEY in .env to enable Whisper transcription fallback.',
        false
      );
    }

    try {
      audioFilePath = await downloadAudio(videoId, logger, proxyConfig);
      transcript = await transcribeWithWhisper(audioFilePath, videoId, openaiApiKey, logger);
      transcriptSource = 'whisper';

      logger.info({ videoId, source: 'whisper' }, 'Transcript obtained from Whisper');
    } catch (whisperError) {
      if (audioFilePath) {
        try {
          await unlink(audioFilePath);
        } catch (unlinkError) {
          logger.warn({ audioFilePath, error: unlinkError }, 'Failed to delete temporary audio file');
        }
      }

      const whisperErrorMsg = whisperError instanceof Error ? whisperError.message : 'Unknown error';

      if (whisperErrorMsg.includes('403')) {
        throw new ProcessingError(
          'YouTube transcript unavailable and video download blocked by YouTube. Please try a video with captions/subtitles enabled.',
          false
        );
      }

      throw new ProcessingError(
        `Unable to get transcript: YouTube transcript unavailable and Whisper download failed. This video may have restricted access.`,
        false
      );
    }

    if (audioFilePath) {
      try {
        await unlink(audioFilePath);
      } catch (unlinkError) {
        logger.warn({ audioFilePath, error: unlinkError }, 'Failed to delete temporary audio file');
      }
    }
  }

  const sanitizedTitle = sanitizeHtml(metadata.title);
  const sanitizedTranscript = sanitizeHtml(transcript);
  const sanitizedChannel = metadata.channel ? sanitizeHtml(metadata.channel) : undefined;

  logger.info(
    {
      videoId,
      title: sanitizedTitle,
      transcriptLength: sanitizedTranscript.length,
      channel: sanitizedChannel,
      transcriptSource,
    },
    'YouTube video processed successfully'
  );

  return {
    title: sanitizedTitle,
    content: sanitizedTranscript,
    metadata: {
      type: 'youtube',
      sourceUrl: validatedUrl,
      ...(sanitizedChannel ? { author: sanitizedChannel } : {}),
    },
    embedText: `${sanitizedTitle}\n\n${sanitizedTranscript.slice(0, 3000)}`,
  };
}
