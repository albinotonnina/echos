export interface TranscribeOptions {
  audioBuffer: Buffer;
  mimeType: string;
  language?: string;
}

export interface TranscribeResult {
  text: string;
  provider: string;
  duration?: number;
}

export interface SpeechToTextClient {
  transcribe(options: TranscribeOptions): Promise<TranscribeResult>;
}

export async function transcribeWithRetry(
  client: SpeechToTextClient,
  options: TranscribeOptions,
  maxRetries = 2,
): Promise<TranscribeResult> {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await client.transcribe(options);
    } catch (err) {
      const isRateLimit = err instanceof Error && err.name === 'RateLimitError';
      if (isRateLimit && i < maxRetries) {
        const delay = Math.pow(2, i) * 1000;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('unreachable');
}

export { createSttClient } from './factory.js';
export { OpenAICompatibleClient } from './openai-compatible-client.js';
export { LocalWhisperClient } from './local-whisper-client.js';
