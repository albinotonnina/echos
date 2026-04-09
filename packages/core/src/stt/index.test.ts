import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSttClient } from './factory.js';
import { OpenAICompatibleClient } from './openai-compatible-client.js';
import { LocalWhisperClient } from './local-whisper-client.js';
import {
  detectProviderFromKey,
  detectProviderFromModel,
  detectProviderFromUrl,
  probeProvider,
  loadCachedProvider,
  saveCachedProvider,
  getCloudProviders,
  getProbeableProviders,
} from './registry.js';
import type { Config } from '@echos/shared';

describe('createSttClient', () => {
  it('returns undefined when no STT config is provided', async () => {
    const config = { sttProvider: 'auto' as const } as Config;
    expect(await createSttClient(config)).toBeUndefined();
  });

  it('creates OpenAICompatibleClient when sttApiKey is set (auto mode)', async () => {
    const config = {
      sttProvider: 'auto' as const,
      sttApiKey: 'sk-test',
    } as Config;
    const client = await createSttClient(config);
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });

  it('auto-detects Groq from gsk_ key prefix', async () => {
    const config = {
      sttProvider: 'auto' as const,
      sttApiKey: 'gsk_test123',
    } as Config;
    const client = await createSttClient(config);
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });

  it('auto-detects HuggingFace from hf_ key prefix', async () => {
    const config = {
      sttProvider: 'auto' as const,
      sttApiKey: 'hf_test123',
    } as Config;
    const client = await createSttClient(config);
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });

  it('auto-detects OpenRouter from sk-or- key prefix', async () => {
    const config = {
      sttProvider: 'auto' as const,
      sttApiKey: 'sk-or-test123',
    } as Config;
    const client = await createSttClient(config);
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });

  it('uses explicit provider when set', async () => {
    const config = {
      sttProvider: 'groq' as const,
      sttApiKey: 'sk-some-key',
    } as Config;
    const client = await createSttClient(config);
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });

  it('uses custom baseUrl and model for explicit provider', async () => {
    const config = {
      sttProvider: 'groq' as const,
      sttApiKey: 'gsk-test',
      sttBaseUrl: 'https://api.groq.com/openai/v1',
      sttModel: 'whisper-large-v3-turbo',
    } as Config;
    const client = await createSttClient(config);
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });

  it('creates LocalWhisperClient when provider is local', async () => {
    const config = {
      sttProvider: 'local' as const,
      sttLocalCommand: 'whisper-cpp',
      sttLocalModel: 'base.en',
    } as Config;
    const client = await createSttClient(config);
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

describe('STT provider detection', () => {
  describe('detectProviderFromKey', () => {
    it('detects OpenAI from sk- prefix', () => {
      expect(detectProviderFromKey('sk-abc123')).toBe('openai');
    });

    it('detects Groq from gsk_ prefix', () => {
      expect(detectProviderFromKey('gsk_abc123')).toBe('groq');
    });

    it('detects HuggingFace from hf_ prefix', () => {
      expect(detectProviderFromKey('hf_abc123')).toBe('huggingface');
    });

    it('detects OpenRouter from sk-or- prefix', () => {
      expect(detectProviderFromKey('sk-or-abc123')).toBe('openrouter');
    });

    it('returns undefined for unknown prefix', () => {
      expect(detectProviderFromKey('unknown-abc123')).toBeUndefined();
    });

    it('returns undefined for providers with no known prefix (together, siliconflow, deepinfra, fireworks)', () => {
      expect(detectProviderFromKey('some-opaque-key')).toBeUndefined();
    });
  });

  describe('detectProviderFromUrl', () => {
    it('detects OpenAI from base URL', () => {
      expect(detectProviderFromUrl('https://api.openai.com/v1')).toBe('openai');
    });

    it('detects Groq from base URL', () => {
      expect(detectProviderFromUrl('https://api.groq.com/openai/v1')).toBe('groq');
    });

    it('detects Together AI from base URL', () => {
      expect(detectProviderFromUrl('https://api.together.xyz/v1')).toBe('together');
    });

    it('detects DeepInfra from base URL', () => {
      expect(detectProviderFromUrl('https://api.deepinfra.com/v1/openai')).toBe('deepinfra');
    });

    it('detects SiliconFlow from base URL', () => {
      expect(detectProviderFromUrl('https://api.siliconflow.com/v1')).toBe('siliconflow');
    });

    it('detects Fireworks from base URL', () => {
      expect(detectProviderFromUrl('https://api.fireworks.ai/inference/v1')).toBe('fireworks');
    });

    it('detects HuggingFace from base URL', () => {
      expect(detectProviderFromUrl('https://router.huggingface.co/v1')).toBe('huggingface');
    });

    it('detects OpenRouter from base URL', () => {
      expect(detectProviderFromUrl('https://openrouter.ai/api/v1')).toBe('openrouter');
    });

    it('returns undefined for unknown URL', () => {
      expect(detectProviderFromUrl('https://unknown.example.com/v1')).toBeUndefined();
    });
  });

  describe('detectProviderFromModel', () => {
    it('detects Groq from whisper-large-v3', () => {
      expect(detectProviderFromModel('whisper-large-v3')).toBe('groq');
    });

    it('detects Groq from whisper-large-v3-turbo', () => {
      expect(detectProviderFromModel('whisper-large-v3-turbo')).toBe('groq');
    });

    it('detects SiliconFlow from SenseVoiceSmall', () => {
      expect(detectProviderFromModel('FunAudioLLM/SenseVoiceSmall')).toBe('siliconflow');
    });

    it('returns undefined for unknown model', () => {
      expect(detectProviderFromModel('unknown-model')).toBeUndefined();
    });
  });
});

describe('STT provider probing', () => {
  it('only returns providers with no key prefix', () => {
    const probeable = getProbeableProviders();
    const ids = probeable.map((p) => p.id);
    expect(ids).toContain('together');
    expect(ids).toContain('siliconflow');
    expect(ids).toContain('deepinfra');
    expect(ids).toContain('fireworks');
    expect(ids).not.toContain('openai');
    expect(ids).not.toContain('groq');
    expect(ids).not.toContain('huggingface');
    expect(ids).not.toContain('openrouter');
    expect(ids).not.toContain('local');
  });

  it('returns true when provider accepts the API key', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    });

    const together = getProbeableProviders().find((p) => p.id === 'together')!;
    const result = await probeProvider('some-opaque-key', together);
    expect(result).toBe(true);

    globalThis.fetch = originalFetch;
  });

  it('returns false when provider rejects the API key', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });

    const together = getProbeableProviders().find((p) => p.id === 'together')!;
    const result = await probeProvider('some-invalid-key', together);
    expect(result).toBe(false);

    globalThis.fetch = originalFetch;
  });

  it('returns false on network error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

    const together = getProbeableProviders().find((p) => p.id === 'together')!;
    const result = await probeProvider('some-key', together);
    expect(result).toBe(false);

    globalThis.fetch = originalFetch;
  });

  it('returns false on timeout', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockImplementation((_url: string, opts: { signal?: AbortSignal }) => {
        return new Promise<void>((_, reject) => {
          const onAbort = () => reject(new Error('timeout'));
          if (opts?.signal) {
            if (opts.signal.aborted) {
              reject(new Error('timeout'));
            } else {
              opts.signal.addEventListener('abort', onAbort, { once: true });
            }
          }
        });
      });

    const together = getProbeableProviders().find((p) => p.id === 'together')!;
    const result = await probeProvider('sk-some-key', together);
    expect(result).toBe(false);

    globalThis.fetch = originalFetch;
  }, 10000);
});

describe('STT provider cache', () => {
  it('saves and loads cached provider', () => {
    const testKey = 'test-cache-key-abc123';
    saveCachedProvider(testKey, 'groq');
    const loaded = loadCachedProvider(testKey);
    expect(loaded).toBe('groq');
  });

  it('returns undefined for uncached key', () => {
    const loaded = loadCachedProvider('nonexistent-key-xyz');
    expect(loaded).toBeUndefined();
  });
});
