import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSttClient } from './factory.js';
import { OpenAICompatibleClient } from './openai-compatible-client.js';
import { LocalWhisperClient } from './local-whisper-client.js';
import type { Config } from '@echos/shared';

describe('createSttClient', () => {
  it('returns undefined when no STT config is provided', () => {
    const config = { sttProvider: 'openai-compatible' } as Config;
    expect(createSttClient(config)).toBeUndefined();
  });

  it('creates OpenAICompatibleClient when sttApiKey is set', () => {
    const config = {
      sttProvider: 'openai-compatible',
      sttApiKey: 'sk-test',
    } as Config;
    const client = createSttClient(config);
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });

  it('uses custom baseUrl and model for OpenAICompatibleClient', () => {
    const config = {
      sttProvider: 'openai-compatible',
      sttApiKey: 'gsk-test',
      sttBaseUrl: 'https://api.groq.com/openai/v1',
      sttModel: 'whisper-large-v3-turbo',
    } as Config;
    const client = createSttClient(config);
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });

  it('creates LocalWhisperClient when provider is local', () => {
    const config = {
      sttProvider: 'local',
      sttLocalCommand: 'whisper-cpp',
      sttLocalModel: 'base.en',
    } as Config;
    const client = createSttClient(config);
    expect(client).toBeInstanceOf(LocalWhisperClient);
  });
});

describe('OpenAICompatibleClient', () => {
  it('sends correct FormData to the API', async () => {
    const client = new OpenAICompatibleClient('sk-test', 'https://api.test.com/v1', 'test-model');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('Hello world'),
    });

    const result = await client.transcribe({
      audioBuffer: Buffer.from('fake-audio'),
      mimeType: 'audio/ogg',
      language: 'en',
    });

    expect(result.text).toBe('Hello world');
    expect(result.provider).toBe('test-model');
    expect(result.duration).toBeDefined();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.test.com/v1/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer sk-test' },
      }),
    );

    globalThis.fetch = originalFetch;
  });

  it('throws ExternalServiceError on non-429 errors', async () => {
    const client = new OpenAICompatibleClient('sk-test', 'https://api.test.com/v1', 'test-model');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Server error'),
    });

    await expect(
      client.transcribe({
        audioBuffer: Buffer.from('fake-audio'),
        mimeType: 'audio/ogg',
      }),
    ).rejects.toThrow('Transcription failed (500): Server error');

    globalThis.fetch = originalFetch;
  });
});
