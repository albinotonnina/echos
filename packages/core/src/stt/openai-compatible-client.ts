import { ExternalServiceError, RateLimitError } from '@echos/shared';
import type { SpeechToTextClient, TranscribeOptions, TranscribeResult } from './index.js';

export class OpenAICompatibleClient implements SpeechToTextClient {
  constructor(
    private apiKey: string,
    private baseUrl: string,
    private model: string,
  ) {}

  async transcribe({
    audioBuffer,
    mimeType,
    language,
  }: TranscribeOptions): Promise<TranscribeResult> {
    const start = Date.now();
    const form = new FormData();
    const uint8Array = new Uint8Array(audioBuffer);
    form.append('file', new Blob([uint8Array], { type: mimeType }), 'audio.ogg');
    form.append('model', this.model);
    if (language) form.append('language', language);
    form.append('response_format', 'text');

    const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) {
        throw new RateLimitError(5000);
      }
      throw new ExternalServiceError('STT', `Transcription failed (${res.status}): ${body}`, true);
    }

    const text = await res.text();
    return { text: text.trim(), provider: this.model, duration: Date.now() - start };
  }
}
