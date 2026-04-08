import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { writeFile, unlink } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { v4 as uuidv4 } from 'uuid';
import type { NoteMetadata } from '@echos/shared';
import { validateUrl } from '@echos/shared';
import type { PluginContext, SpeechToTextClient, TranscribeOptions } from '@echos/core';
import { categorizeContent, type ProcessingMode, transcribeWithRetry } from '@echos/core';
import {
  WHISPER_MAX_BYTES,
  downloadInChunks,
  downloadFull,
  probeContentLength,
  type AudioChunk,
} from './chunker.js';

/** Audio MIME types accepted by the Whisper API, keyed by extension. */
const SUPPORTED_EXTENSIONS: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.mp4': 'audio/mp4',
  '.flac': 'audio/flac',
};

function getAudioMime(filename: string): string | undefined {
  return SUPPORTED_EXTENSIONS[extname(filename).toLowerCase()];
}

/** Format bytes as a human-readable string. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Estimate duration from file size using a rough bitrate guess.
 * This is only a ballpark; we don't parse audio headers.
 */
function estimateDuration(bytes: number, mimeType: string): string {
  // Approximate average bitrates for common formats
  const bitrateKbps =
    mimeType === 'audio/wav'
      ? 1411 // uncompressed
      : mimeType === 'audio/flac'
        ? 800 // lossless compressed
        : 128; // compressed (mp3/ogg/m4a/etc.)

  const seconds = Math.round((bytes * 8) / (bitrateKbps * 1000));
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes > 0 ? `~${minutes}m ${secs}s` : `~${secs}s`;
}

const schema = Type.Object({
  url: Type.String({
    description: 'URL of the audio file or podcast episode to download and transcribe',
    format: 'uri',
  }),
  title: Type.Optional(
    Type.String({
      description: 'Optional title for the saved note (defaults to filename from URL)',
    }),
  ),
  tags: Type.Optional(
    Type.Array(Type.String(), { description: 'Tags to apply to the saved note' }),
  ),
  categorize: Type.Optional(
    Type.Boolean({
      description: 'Automatically categorize using AI (default: true)',
      default: true,
    }),
  ),
});

type Params = Static<typeof schema>;

/**
 * Transcribe a single audio buffer via the configured STT provider.
 */
async function transcribeBuffer(
  sttClient: SpeechToTextClient,
  data: Buffer,
  filename: string,
  language?: string,
): Promise<string> {
  const mimeType = getAudioMime(filename) || 'audio/mpeg';
  const result = await transcribeWithRetry(sttClient, {
    audioBuffer: data,
    mimeType,
    ...(language ? { language } : {}),
  });
  return result.text;
}

export function createSaveAudioTool(context: PluginContext): AgentTool<typeof schema> {
  return {
    name: 'save_audio',
    label: 'Save Audio / Podcast',
    description:
      'Download an audio file or podcast episode from a URL, transcribe it via OpenAI Whisper, ' +
      'and save the transcript as a searchable knowledge note. ' +
      'Supports mp3, wav, m4a, ogg, webm, mp4, flac. ' +
      'Files larger than 25 MB are automatically split into chunks. ' +
      'Requires OPENAI_API_KEY to be configured.',
    parameters: schema,
    execute: async (_toolCallId: string, params: Params, _signal, onUpdate) => {
      // Validate URL (SSRF protection)
      const safeUrl = validateUrl(params.url);

      // Determine filename and audio format from the URL
      const urlPath = new URL(safeUrl).pathname;
      const urlFilenameRaw = urlPath.split('/').pop() ?? '';
      let urlFilename: string;
      try {
        urlFilename = decodeURIComponent(urlFilenameRaw);
      } catch {
        // Malformed percent-encoding — fall back to the raw segment
        urlFilename = urlFilenameRaw;
      }
      if (!urlFilename) urlFilename = 'audio';
      const mimeType = getAudioMime(urlFilename);

      if (mimeType === undefined) {
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `Unsupported audio format. Supported extensions: ${Object.keys(SUPPORTED_EXTENSIONS).join(', ')}. ` +
                `Got: "${extname(urlFilename) || '(no extension)'}"`,
            },
          ],
          details: { error: 'unsupported_format' },
        };
      }

      const sttClient = context.sttClient;
      if (!sttClient) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'STT provider is not configured. Set STT_API_KEY (or STT_PROVIDER=local) to enable transcription.',
            },
          ],
          details: { error: 'missing_stt_config' },
        };
      }

      onUpdate?.({
        content: [{ type: 'text', text: `Checking audio file at ${safeUrl}...` }],
        details: { phase: 'probing' },
      });

      // Probe file size: HEAD first, then Range probe as fallback.
      // Knowing the size up front lets us choose chunked vs. full download
      // and avoids buffering a potentially huge file before rejecting it.
      let contentLength: number | undefined;
      try {
        const headResponse = await fetch(safeUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        });
        const cl = headResponse.headers.get('content-length');
        if (cl !== null && Number.isFinite(parseInt(cl, 10))) {
          contentLength = parseInt(cl, 10);
        }
      } catch {
        // HEAD failed — try range probe next
      }

      // If HEAD didn't reveal the size, probe via Range: bytes=0-0 to read
      // the Content-Range total without downloading the body.
      if (contentLength === undefined) {
        contentLength = await probeContentLength(safeUrl);
      }

      const language =
        typeof context.config['whisperLanguage'] === 'string'
          ? context.config['whisperLanguage']
          : undefined;

      let transcript: string;
      let fileSizeBytes: number;

      if (contentLength !== undefined && contentLength > WHISPER_MAX_BYTES) {
        // Large file: split into chunks
        const chunkCount = Math.ceil(contentLength / (24 * 1024 * 1024));
        onUpdate?.({
          content: [
            {
              type: 'text',
              text: `Audio is ${formatBytes(contentLength)} — splitting into ${chunkCount} chunks for Whisper...`,
            },
          ],
          details: { phase: 'chunking', contentLength, chunkCount },
        });

        let chunks: AudioChunk[];
        try {
          chunks = await downloadInChunks(safeUrl, contentLength);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: `Failed to download audio: ${message}` }],
            details: { error: message },
          };
        }

        fileSizeBytes = contentLength;
        const parts: string[] = [];

        for (const chunk of chunks) {
          onUpdate?.({
            content: [
              {
                type: 'text',
                text: `Transcribing chunk ${chunk.index + 1}/${chunk.total} (${formatBytes(chunk.data.length)})...`,
              },
            ],
            details: { phase: 'transcribing', chunkIndex: chunk.index, chunkTotal: chunk.total },
          });

          let chunkText: string;
          try {
            chunkText = await transcribeBuffer(sttClient, chunk.data, urlFilename, language);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Transcription failed on chunk ${chunk.index + 1}/${chunk.total}: ${message}`,
                },
              ],
              details: { error: message },
            };
          }

          if (chunkText) parts.push(chunkText);
        }

        transcript = parts.join('\n\n');
      } else {
        // Small file (or unknown size): download fully then transcribe
        onUpdate?.({
          content: [{ type: 'text', text: `Downloading audio from ${safeUrl}...` }],
          details: { phase: 'downloading' },
        });

        let audioBuffer: Buffer;
        try {
          audioBuffer = await downloadFull(safeUrl);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: `Failed to download audio: ${message}` }],
            details: { error: message },
          };
        }

        fileSizeBytes = audioBuffer.length;

        onUpdate?.({
          content: [
            {
              type: 'text',
              text: `Transcribing ${formatBytes(fileSizeBytes)} of audio via Whisper...`,
            },
          ],
          details: { phase: 'transcribing' },
        });

        try {
          transcript = await transcribeBuffer(sttClient, audioBuffer, urlFilename, language);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: `Transcription failed: ${message}` }],
            details: { error: message },
          };
        }
      }

      if (!transcript) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Whisper returned an empty transcript. The audio may be silent or in an unsupported language.',
            },
          ],
          details: { error: 'empty_transcript' },
        };
      }

      const title = params.title ?? (urlFilename.replace(/\.[^.]+$/, '') || 'Audio Transcript');
      const durationEstimate = estimateDuration(fileSizeBytes, mimeType);

      let category = 'notes';
      let tags = params.tags ?? [];
      let gist: string | undefined;

      const shouldCategorize = params.categorize !== false;
      if (shouldCategorize && context.config.anthropicApiKey) {
        onUpdate?.({
          content: [{ type: 'text', text: 'Categorizing transcript with AI...' }],
          details: { phase: 'categorizing' },
        });

        try {
          const mode: ProcessingMode = 'full';
          const vocabulary = context.sqlite.getTopTagsWithCounts(50);
          const result = await categorizeContent(
            title,
            transcript,
            mode,
            context.config.anthropicApiKey as string,
            context.logger,
            (message) =>
              onUpdate?.({
                content: [{ type: 'text', text: message }],
                details: { phase: 'categorizing' },
              }),
            context.config.defaultModel as string,
            undefined,
            vocabulary,
          );

          category = result.category;
          tags = result.tags;
          if ('gist' in result) {
            gist = result.gist;
          }
          context.logger.info({ category, tags }, 'Audio transcript auto-categorized');
        } catch (error) {
          context.logger.error({ error }, 'Auto-categorization failed, using defaults');
        }
      }

      const now = new Date().toISOString();
      const id = uuidv4();

      const metadata: NoteMetadata = {
        id,
        type: 'note',
        title,
        created: now,
        updated: now,
        tags,
        links: [],
        category,
        sourceUrl: safeUrl,
        status: 'saved',
        inputSource: 'voice',
      };
      if (gist) metadata.gist = gist;

      const header =
        `**Source:** ${safeUrl}\n` +
        `**Format:** ${extname(urlFilename).toLowerCase().slice(1).toUpperCase()}\n` +
        `**File size:** ${formatBytes(fileSizeBytes)}\n` +
        `**Duration estimate:** ${durationEstimate}\n` +
        `**Transcript length:** ${transcript.length.toLocaleString()} characters\n` +
        '\n---\n\n';

      const fullContent = header + transcript;

      const filePath = context.markdown.save(metadata, fullContent);
      context.sqlite.upsertNote(metadata, fullContent, filePath);

      try {
        const vector = await context.generateEmbedding(transcript.slice(0, 8000));
        await context.vectorDb.upsert({
          id,
          text: transcript.slice(0, 8000),
          vector,
          type: 'note',
          title,
        });
      } catch {
        // Non-fatal — note is saved even if embedding fails
      }

      let responseText = `Saved audio transcript "${title}" (id: ${id})\n`;
      responseText += `Source: ${safeUrl}\n`;
      responseText += `Format: ${extname(urlFilename).toLowerCase().slice(1).toUpperCase()}\n`;
      responseText += `File size: ${formatBytes(fileSizeBytes)}\n`;
      responseText += `Duration estimate: ${durationEstimate}\n`;
      responseText += `Transcript: ${transcript.length.toLocaleString()} characters\n`;
      responseText += `Category: ${category}\n`;
      responseText += `Tags: [${tags.join(', ')}]`;
      if (gist) responseText += `\nGist: ${gist}`;

      return {
        content: [{ type: 'text' as const, text: responseText }],
        details: { id, filePath, title, category, tags, fileSizeBytes, durationEstimate },
      };
    },
  };
}
