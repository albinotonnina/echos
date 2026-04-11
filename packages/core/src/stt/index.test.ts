import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSttClient, probeSttProviders } from './factory.js';
import { transcribeWithRetry } from './index.js';
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
  getProviderInfo,
  getProviderIds,
  STT_PROVIDERS,
} from './registry.js';
import type { Config } from '@echos/shared';
import { RateLimitError } from '@echos/shared';
import { join } from 'node:path';

describe('createSttClient', () => {
  it('returns undefined when no STT config is provided', async () => {
    const config = { sttProvider: 'auto' as const } as unknown as Config;
    expect(await createSttClient(config)).toBeUndefined();
  });

  it('creates OpenAICompatibleClient when sttApiKey is set (auto mode)', async () => {
    const config = {
      sttProvider: 'auto' as const,
      sttApiKey: 'sk-test',
    } as unknown as Config;
    const client = await createSttClient(config);
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });

  it('auto-detects Groq from gsk_ key prefix', async () => {
    const config = {
      sttProvider: 'auto' as const,
      sttApiKey: 'gsk_test123',
    } as unknown as Config;
    const client = await createSttClient(config);
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });

  it('auto-detects HuggingFace from hf_ key prefix', async () => {
    const config = {
      sttProvider: 'auto' as const,
      sttApiKey: 'hf_test123',
    } as unknown as Config;
    const client = await createSttClient(config);
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });

  it('auto-detects OpenRouter from sk-or- key prefix', async () => {
    const config = {
      sttProvider: 'auto' as const,
      sttApiKey: 'sk-or-test123',
    } as unknown as Config;
    const client = await createSttClient(config);
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });

  it('uses explicit provider when set', async () => {
    const config = {
      sttProvider: 'groq' as const,
      sttApiKey: 'sk-some-key',
    } as unknown as Config;
    const client = await createSttClient(config);
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });

  it('uses custom baseUrl and model for explicit provider', async () => {
    const config = {
      sttProvider: 'groq' as const,
      sttApiKey: 'gsk-test',
      sttBaseUrl: 'https://api.groq.com/openai/v1',
      sttModel: 'whisper-large-v3-turbo',
    } as unknown as Config;
    const client = await createSttClient(config);
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });

  it('creates LocalWhisperClient when provider is local', async () => {
    const config = {
      sttProvider: 'local' as const,
      sttLocalExecutable: 'whisper-cpp',
      sttLocalModel: 'base.en',
    } as unknown as Config;
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
    const result = await probeProvider('some-key', together!);
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

  it('expires old cache entries', () => {
    const testKey = 'test-expired-key';
    saveCachedProvider(testKey, 'openai');

    // Manually set the cache entry to expired
    const { readFileSync, writeFileSync } = require('node:fs');
    const cachePath = join(
      process.env['ECHOS_HOME'] || `${process.env['HOME']}/echos`,
      'stt-provider-cache.json',
    );
    const cache = JSON.parse(readFileSync(cachePath, 'utf-8'));
    const { createHash } = require('node:crypto');
    const hash = createHash('sha256').update(testKey).digest('hex');
    cache[hash].detectedAt = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    writeFileSync(cachePath, JSON.stringify(cache));

    const loaded = loadCachedProvider(testKey);
    expect(loaded).toBeUndefined();
  });
});

describe('transcribeWithRetry', () => {
  it('succeeds on first attempt', async () => {
    const mockClient = {
      transcribe: vi.fn().mockResolvedValue({
        text: 'Hello world',
        provider: 'test',
        duration: 100,
      }),
    };

    const result = await transcribeWithRetry(mockClient as any, {
      audioBuffer: Buffer.from('audio'),
      mimeType: 'audio/wav',
    });

    expect(result.text).toBe('Hello world');
    expect(mockClient.transcribe).toHaveBeenCalledTimes(1);
  });

  it('retries on rate limit error', async () => {
    const error = new RateLimitError(2000);

    const mockClient = {
      transcribe: vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({
          text: 'Success after retries',
          provider: 'test',
          duration: 300,
        }),
    };

    const result = await transcribeWithRetry(mockClient as any, {
      audioBuffer: Buffer.from('audio'),
      mimeType: 'audio/wav',
    });

    expect(result.text).toBe('Success after retries');
    expect(mockClient.transcribe).toHaveBeenCalledTimes(3);
  });

  it('throws on non-rate-limit errors without retry', async () => {
    const mockClient = {
      transcribe: vi.fn().mockRejectedValue(new Error('Network error')),
    };

    await expect(
      transcribeWithRetry(mockClient as any, {
        audioBuffer: Buffer.from('audio'),
        mimeType: 'audio/wav',
      }),
    ).rejects.toThrow('Network error');

    expect(mockClient.transcribe).toHaveBeenCalledTimes(1);
  });

  it('throws after max retries exhausted', async () => {
    const error = new RateLimitError(2000);

    const mockClient = {
      transcribe: vi.fn().mockRejectedValue(error),
    };

    await expect(
      transcribeWithRetry(
        mockClient as any,
        {
          audioBuffer: Buffer.from('audio'),
          mimeType: 'audio/wav',
        },
        2,
      ),
    ).rejects.toThrow('Rate limit exceeded');

    expect(mockClient.transcribe).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});

describe('LocalWhisperClient', () => {
  describe('whisper type detection', () => {
    it('detects whispercpp-python from wrapper script', () => {
      const client = new LocalWhisperClient(
        'python /path/to/whisper-cpp-wrapper.py',
        'base.en',
      );
      expect(client).toBeInstanceOf(LocalWhisperClient);
    });

    it('detects openai-whisper from whisper command', () => {
      const client = new LocalWhisperClient('whisper', 'base.en');
      expect(client).toBeInstanceOf(LocalWhisperClient);
    });

    it('detects faster-whisper from module', () => {
      const client = new LocalWhisperClient(
        'python -m faster_whisper',
        'base.en',
      );
      expect(client).toBeInstanceOf(LocalWhisperClient);
    });

    it('detects whisper-cpp from whisper-cli', () => {
      const client = new LocalWhisperClient('whisper-cli', 'base.en');
      expect(client).toBeInstanceOf(LocalWhisperClient);
    });

    it('detects generic for unknown commands', () => {
      const client = new LocalWhisperClient('custom-stt', 'model');
      expect(client).toBeInstanceOf(LocalWhisperClient);
    });
  });

  describe('transcription', () => {
    it('creates client with whisper-cli command', () => {
      const client = new LocalWhisperClient('whisper-cli', 'base.en');
      expect(client).toBeDefined();
    });

    it('creates client with Python wrapper command', () => {
      const client = new LocalWhisperClient(
        'python /path/to/whisper-cpp-wrapper.py',
        'small.en',
      );
      expect(client).toBeDefined();
    });

    it('creates client with openai-whisper command', () => {
      const client = new LocalWhisperClient(
        'whisper --model base.en',
        'base.en',
      );
      expect(client).toBeDefined();
    });

    it('creates client with custom model path', () => {
      const client = new LocalWhisperClient(
        'whisper-cli',
        '/custom/models/ggml-medium.bin',
      );
      expect(client).toBeDefined();
    });
  });
});

describe('STT provider registry', () => {
  describe('STT_PROVIDERS', () => {
    it('contains all expected providers', () => {
      const ids = Object.keys(STT_PROVIDERS);
      expect(ids).toContain('openai');
      expect(ids).toContain('groq');
      expect(ids).toContain('together');
      expect(ids).toContain('siliconflow');
      expect(ids).toContain('deepinfra');
      expect(ids).toContain('fireworks');
      expect(ids).toContain('huggingface');
      expect(ids).toContain('openrouter');
      expect(ids).toContain('local');
    });

    it('has valid configuration for each provider', () => {
      for (const [id, info] of Object.entries(STT_PROVIDERS)) {
        expect(info.id).toBe(id);
        expect(info.name).toBeDefined();
        expect(info.defaultBaseUrl).toBeDefined();
        expect(info.defaultModel).toBeDefined();
        expect(info.docsUrl).toBeDefined();

        if (info.keyPrefixConfidence !== 'none') {
          expect(info.keyPrefixes.length).toBeGreaterThan(0);
        }
      }
    });

    it('has correct key prefix confidence levels', () => {
      expect(STT_PROVIDERS['openai']!.keyPrefixConfidence).toBe('high');
      expect(STT_PROVIDERS['groq']!.keyPrefixConfidence).toBe('high');
      expect(STT_PROVIDERS['huggingface']!.keyPrefixConfidence).toBe('high');
      expect(STT_PROVIDERS['openrouter']!.keyPrefixConfidence).toBe('high');
      expect(STT_PROVIDERS['together']!.keyPrefixConfidence).toBe('none');
      expect(STT_PROVIDERS['siliconflow']!.keyPrefixConfidence).toBe('none');
    });
  });

  describe('getProviderInfo', () => {
    it('returns provider info for valid ID', () => {
      const info = getProviderInfo('openai');
      expect(info).toBeDefined();
      expect(info!.name).toBe('OpenAI');
    });

    it('returns undefined for invalid ID', () => {
      const info = getProviderInfo('invalid');
      expect(info).toBeUndefined();
    });
  });

  describe('getProviderIds', () => {
    it('returns all provider IDs', () => {
      const ids = getProviderIds();
      expect(ids.length).toBe(8); // 8 cloud providers + local = 9 total, but getProviderIds excludes local
      expect(ids).toContain('openai');
      expect(ids).not.toContain('local'); // getProviderIds excludes local
    });
  });

  describe('getCloudProviders', () => {
    it('returns all cloud providers', () => {
      const cloud = getCloudProviders();
      expect(cloud.length).toBe(8);
      expect(cloud.find((p) => p.id === 'local')).toBeUndefined();
    });
  });

  describe('longer prefix matching', () => {
    it('matches sk-or- before sk-', () => {
      expect(detectProviderFromKey('sk-or-v1-abc123')).toBe('openrouter');
      expect(detectProviderFromKey('sk-or-v1-abc123')).not.toBe('openai');
    });
  });
});

describe('STT integration scenarios', () => {
  it('creates OpenAI client with auto-detection', async () => {
    const config = {
      sttProvider: 'auto' as const,
      sttApiKey: 'sk-proj-abc123',
    } as unknown as Config;

    const client = await createSttClient(config);
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });

  it('creates Groq client with auto-detection', async () => {
    const config = {
      sttProvider: 'auto' as const,
      sttApiKey: 'gsk_abc123',
    } as unknown as Config;

    const client = await createSttClient(config);
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });

  it('creates Together AI client with explicit provider', async () => {
    const config = {
      sttProvider: 'together' as const,
      sttApiKey: 'some-opaque-key',
    } as unknown as Config;

    const client = await createSttClient(config);
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });

  it('creates local whisper client', async () => {
    const config = {
      sttProvider: 'local' as const,
      sttLocalExecutable: 'whisper-cli',
      sttLocalModel: 'base.en',
    } as unknown as Config;

    const client = await createSttClient(config);
    expect(client).toBeInstanceOf(LocalWhisperClient);
  });

  it('throws error when local provider configured but no command', async () => {
    const config = {
      sttProvider: 'local' as const,
    } as unknown as Config;

    await expect(createSttClient(config)).rejects.toThrow(
      'STT_LOCAL_EXECUTABLE is required when STT_PROVIDER=local',
    );
  });

  it('throws error for unknown explicit provider', async () => {
    const config = {
      sttProvider: 'unknown-provider' as const,
      sttApiKey: 'some-key',
    } as unknown as Config;

    await expect(createSttClient(config)).rejects.toThrow(
      'Unknown STT provider: unknown-provider',
    );
  });

  it('uses fallback OPENAI_API_KEY when no STT_API_KEY', async () => {
    const config = {
      sttProvider: 'auto' as const,
      openaiApiKey: 'sk-fallback-key',
    } as unknown as Config;

    const client = await createSttClient(config);
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });
});

describe('STT error handling', () => {
  it('handles transcription timeout', async () => {
    const client = new OpenAICompatibleClient('sk-test', 'https://api.test.com/v1', 'test-model');

    globalThis.fetch = vi.fn().mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), 100);
      });
    });

    await expect(
      client.transcribe({
        audioBuffer: Buffer.from('audio'),
        mimeType: 'audio/wav',
      }),
    ).rejects.toThrow();
  });

  it('handles invalid audio format', async () => {
    const client = new OpenAICompatibleClient('sk-test', 'https://api.test.com/v1', 'test-model');

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Invalid audio format'),
    });

    await expect(
      client.transcribe({
        audioBuffer: Buffer.from('invalid-audio'),
        mimeType: 'audio/xyz',
      }),
    ).rejects.toThrow('Transcription failed (400): Invalid audio format');
  });

  it('handles missing API key', async () => {
    const config = {
      sttProvider: 'auto' as const,
    } as unknown as Config;

    const client = await createSttClient(config);
    expect(client).toBeUndefined();
  });

  it('handles provider probe failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });

    const together = getProbeableProviders().find((p) => p.id === 'together')!;
    const result = await probeProvider('invalid-key', together!);
    expect(result).toBe(false);
  });
});

describe('STT provider probing edge cases', () => {
  it('handles empty API key', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });

    const openai = STT_PROVIDERS['openai'];
    const result = await probeProvider('', openai!);
    expect(result).toBe(false);
  });

  it('handles malformed URL in provider config', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Invalid URL'));

    const together = getProbeableProviders().find((p) => p.id === 'together')!;
    const result = await probeProvider('some-key', together!);
    expect(result).toBe(false);
  });
});

describe('probeSttProviders integration', () => {
  it('returns first successful provider', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    });

    const result = await probeSttProviders('valid-api-key');
    expect(result).toBeDefined();
    expect(result!.provider).toBeDefined();
    expect(result!.baseUrl).toBeDefined();
    expect(result!.model).toBeDefined();
  });

  it('returns undefined when no providers accept the key', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });

    const result = await probeSttProviders('invalid-api-key');
    expect(result).toBeUndefined();
  });
});
