import ytdl from '@distube/ytdl-core';
import OpenAI from 'openai';
import { createWriteStream } from 'fs';
import { unlink, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import type { Logger } from 'pino';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { validateUrl, sanitizeHtml, ProcessingError, ExternalServiceError } from '@echos/shared';
import type { ProcessedContent } from '@echos/shared';

export type ProxyConfig = { username: string; password: string } | undefined;

function createProxyAgent(proxyConfig: ProxyConfig): HttpsProxyAgent<string> | undefined {
  if (!proxyConfig) return undefined;
  const proxyUrl = `http://${proxyConfig.username}:${proxyConfig.password}@p.webshare.io:80`;
  return new HttpsProxyAgent(proxyUrl);
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
 * Fetch transcript using Python youtube-transcript-api (more reliable than JS libraries)
 */
async function fetchYoutubeTranscript(videoId: string, logger: Logger, proxyConfig?: ProxyConfig): Promise<string> {
  logger.debug({ videoId, hasProxy: !!proxyConfig }, 'Fetching YouTube transcript via Python');

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new ProcessingError('Transcript fetch timeout', true));
    }, TRANSCRIPT_TIMEOUT_MS);

    const proxyImport = proxyConfig
      ? `from youtube_transcript_api.proxies import WebshareProxyConfig\n`
      : '';
    const apiInit = proxyConfig
      ? `YouTubeTranscriptApi(proxy_config=WebshareProxyConfig(proxy_username="${proxyConfig.username}", proxy_password="${proxyConfig.password}"))`
      : `YouTubeTranscriptApi()`;

    const pythonCode = `import json
${proxyImport}from youtube_transcript_api import YouTubeTranscriptApi

try:
    api = ${apiInit}
    transcript_list = api.list('${videoId}')
    
    # Try to find transcript in order: manual en, generated en, any english, any available
    transcript = None
    try:
        transcript = transcript_list.find_transcript(['en'])
    except:
        try:
            transcript = transcript_list.find_generated_transcript(['en'])
        except:
            # Get any available transcript
            for t in transcript_list:
                transcript = t
                break
    
    if transcript is None:
        raise Exception('No transcript available')
    
    transcript_data = transcript.fetch()
    text = ' '.join([entry.text for entry in transcript_data])
    print(json.dumps({'success': True, 'text': text, 'segments': len(transcript_data)}))
except Exception as e:
    print(json.dumps({'success': False, 'error': str(e)}))
`;

    const python = spawn('python3', ['-c', pythonCode]);
    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        logger.warn({ videoId, stderr, code }, 'Python transcript fetch failed');
        reject(
          new ProcessingError(`Python process exited with code ${code}: ${stderr}`, true)
        );
        return;
      }

      try {
        const result = JSON.parse(stdout.trim());

        if (!result.success) {
          logger.warn({ videoId, error: result.error }, 'YouTube transcript unavailable');
          reject(new ProcessingError(`YouTube transcript unavailable: ${result.error}`, true));
          return;
        }

        const transcript = result.text;

        if (!transcript || transcript.length === 0) {
          reject(new ProcessingError('No transcript data returned', true));
          return;
        }

        if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
          reject(
            new ProcessingError(
              `Transcript too long: ${transcript.length} characters`,
              false
            )
          );
          return;
        }

        logger.info(
          { videoId, transcriptLength: transcript.length, segments: result.segments },
          'YouTube transcript fetched successfully'
        );
        resolve(transcript);
      } catch (parseError) {
        logger.error({ videoId, stdout, parseError }, 'Failed to parse Python output');
        reject(new ProcessingError('Failed to parse transcript response', true));
      }
    });

    python.on('error', (error) => {
      clearTimeout(timeout);
      logger.error({ videoId, error }, 'Failed to spawn Python process');

      if (error.message.includes('ENOENT') || error.message.includes('python3')) {
        reject(
          new ProcessingError(
            'Python 3 is required for YouTube transcript extraction. Install youtube-transcript-api: pip3 install youtube-transcript-api',
            false
          )
        );
      } else {
        reject(new ProcessingError(`Failed to run Python: ${error.message}`, true));
      }
    });
  });
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
 * Get video metadata — prefers yt-dlp CLI (reliable), falls back to ytdl-core, then dummy title
 */
async function getVideoMetadata(
  videoId: string,
  logger: Logger,
  proxyConfig?: ProxyConfig
): Promise<{ title: string; channel?: string; duration?: number; publishedDate?: string }> {
  if (proxyConfig) {
    return getVideoMetadataViaPython(videoId, logger, proxyConfig);
  }

  // yt-dlp CLI is more reliable than ytdl-core (actively maintained, handles YouTube changes)
  const ytdlpResult = await getVideoMetadataViaPythonNoProxy(videoId, logger);
  if (ytdlpResult.title !== `YouTube Video ${videoId}`) {
    return ytdlpResult;
  }

  // Last resort: try ytdl-core
  logger.warn({ videoId }, 'yt-dlp failed, trying ytdl-core as last resort');
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const info = await withYtdlCache(async () => ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
    }));
    return {
      title: info.videoDetails.title || 'Untitled',
      channel: info.videoDetails.author.name,
      duration: parseInt(info.videoDetails.lengthSeconds, 10),
      publishedDate: info.videoDetails.publishDate,
    };
  } catch (error) {
    logger.warn({ videoId, error }, 'ytdl-core also failed, using dummy title');
    return { title: `YouTube Video ${videoId}` };
  }
}

/**
 * Fetch video metadata via yt-dlp CLI without proxy
 */
function getVideoMetadataViaPythonNoProxy(
  videoId: string,
  logger: Logger,
): Promise<{ title: string; channel?: string; duration?: number; publishedDate?: string }> {
  return new Promise((resolve) => {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const ytdlp = spawn('yt-dlp', [
      '--dump-json',
      '--no-playlist',
      '--socket-timeout', '30',
      url,
    ]);

    let stdout = '';
    let stderr = '';

    ytdlp.stdout.on('data', (data) => { stdout += data.toString(); });
    ytdlp.stderr.on('data', (data) => { stderr += data.toString(); });

    ytdlp.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        logger.warn({ videoId, stderr, code }, 'yt-dlp CLI metadata fetch failed');
        resolve({ title: `YouTube Video ${videoId}` });
        return;
      }

      try {
        const info = JSON.parse(stdout.trim());
        const title = info.title || 'Untitled';
        const channel = info.uploader || info.channel || undefined;
        logger.info({ videoId, title, channel }, 'Metadata fetched via yt-dlp CLI');
        resolve({
          title,
          channel,
          duration: info.duration || undefined,
          publishedDate: info.upload_date || undefined,
        });
      } catch (parseError) {
        logger.warn({ videoId, parseError }, 'Failed to parse yt-dlp output');
        resolve({ title: `YouTube Video ${videoId}` });
      }
    });

    ytdlp.on('error', (error) => {
      logger.warn({ videoId, error: error.message }, 'Failed to spawn yt-dlp');
      resolve({ title: `YouTube Video ${videoId}` });
    });
  });
}

/**
 * Fetch video metadata via yt-dlp (Python) with proxy support
 */
function getVideoMetadataViaPython(
  videoId: string,
  logger: Logger,
  proxyConfig: NonNullable<ProxyConfig>
): Promise<{ title: string; channel?: string; duration?: number; publishedDate?: string }> {
  const proxy = `http://${proxyConfig.username}:${proxyConfig.password}@p.webshare.io:80`;
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  return new Promise((resolve) => {
    const ytdlp = spawn('yt-dlp', [
      '--dump-json',
      '--no-playlist',
      '--proxy', proxy,
      '--socket-timeout', '30',
      url,
    ]);

    let stdout = '';
    let stderr = '';

    ytdlp.stdout.on('data', (data) => { stdout += data.toString(); });
    ytdlp.stderr.on('data', (data) => { stderr += data.toString(); });

    ytdlp.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        logger.warn({ videoId, stderr, code }, 'yt-dlp metadata fetch failed');
        resolve({ title: `YouTube Video ${videoId}` });
        return;
      }

      try {
        const info = JSON.parse(stdout.trim());
        const title = info.title || 'Untitled';
        const channel = info.uploader || info.channel || undefined;
        logger.info({ videoId, title, channel }, 'Metadata fetched via yt-dlp (proxy)');
        resolve({
          title,
          channel,
          duration: info.duration || undefined,
          publishedDate: info.upload_date || undefined,
        });
      } catch (parseError) {
        logger.warn({ videoId, parseError }, 'Failed to parse yt-dlp output');
        resolve({ title: `YouTube Video ${videoId}` });
      }
    });

    ytdlp.on('error', (error) => {
      logger.warn({ videoId, error: error.message }, 'Failed to spawn yt-dlp');
      resolve({ title: `YouTube Video ${videoId}` });
    });
  });
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
