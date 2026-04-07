import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * STT Provider Registry
 *
 * Maps known Whisper-compatible providers to their configuration.
 * Supports auto-detection via API key prefix, base URL, and model name.
 *
 * Key prefix confidence levels:
 *   HIGH  - Confirmed from official docs or multiple independent sources
 *   LOW   - Community-reported, not independently verified
 *   NONE  - No known prefix pattern (provider uses opaque keys)
 */

export interface SttProviderInfo {
  /** Canonical provider ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Known API key prefixes for auto-detection (empty means no reliable prefix) */
  keyPrefixes: string[];
  /** Confidence level of key prefix detection: HIGH, LOW, or NONE */
  keyPrefixConfidence: 'high' | 'low' | 'none';
  /** Default base URL for the provider */
  defaultBaseUrl: string;
  /** Default model name for the provider */
  defaultModel: string;
  /** Known model aliases that map to this provider */
  modelHints: string[];
  /** Documentation URL */
  docsUrl: string;
}

export const STT_PROVIDERS: Record<string, SttProviderInfo> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    keyPrefixes: ['sk-'],
    keyPrefixConfidence: 'high',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'whisper-1',
    modelHints: ['whisper-1'],
    docsUrl: 'https://platform.openai.com/docs/guides/speech-to-text',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    keyPrefixes: ['gsk_'],
    keyPrefixConfidence: 'high',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'whisper-large-v3-turbo',
    modelHints: ['whisper-large-v3', 'whisper-large-v3-turbo'],
    docsUrl: 'https://console.groq.com/docs/models',
  },
  together: {
    id: 'together',
    name: 'Together AI',
    keyPrefixes: [],
    keyPrefixConfidence: 'none',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'openai/whisper-large-v3-turbo',
    modelHints: ['whisper-large-v3', 'whisper-large-v3-turbo', 'openai/whisper-large-v3-turbo'],
    docsUrl: 'https://docs.together.ai/docs/audio-overview',
  },
  siliconflow: {
    id: 'siliconflow',
    name: 'SiliconFlow',
    keyPrefixes: [],
    keyPrefixConfidence: 'none',
    defaultBaseUrl: 'https://api.siliconflow.com/v1',
    defaultModel: 'FunAudioLLM/SenseVoiceSmall',
    modelHints: ['SenseVoiceSmall', 'FunAudioLLM/SenseVoiceSmall'],
    docsUrl: 'https://docs.siliconflow.cn/en/docs/audio/audio',
  },
  deepinfra: {
    id: 'deepinfra',
    name: 'DeepInfra',
    keyPrefixes: [],
    keyPrefixConfidence: 'none',
    defaultBaseUrl: 'https://api.deepinfra.com/v1/openai',
    defaultModel: 'openai/whisper-large-v3-turbo',
    modelHints: ['whisper-large-v3', 'whisper-large-v3-turbo', 'openai/whisper-large-v3-turbo'],
    docsUrl: 'https://deepinfra.com/openai/whisper-large-v3-turbo',
  },
  fireworks: {
    id: 'fireworks',
    name: 'Fireworks AI',
    keyPrefixes: [],
    keyPrefixConfidence: 'none',
    defaultBaseUrl: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'whisper-large-v3-turbo',
    modelHints: ['whisper-large-v3', 'whisper-large-v3-turbo'],
    docsUrl: 'https://docs.fireworks.ai/models/audio',
  },
  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face',
    keyPrefixes: ['hf_'],
    keyPrefixConfidence: 'high',
    defaultBaseUrl: 'https://router.huggingface.co/v1',
    defaultModel: 'openai/whisper-large-v3-turbo',
    modelHints: ['whisper-large-v3', 'whisper-large-v3-turbo', 'openai/whisper-large-v3-turbo'],
    docsUrl: 'https://huggingface.co/docs/inference-providers',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    keyPrefixes: ['sk-or-'],
    keyPrefixConfidence: 'high',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/whisper-large-v3-turbo',
    modelHints: ['whisper-large-v3', 'whisper-large-v3-turbo', 'openai/whisper-large-v3-turbo'],
    docsUrl: 'https://openrouter.ai/models?modality=text%3Aaudio',
  },
  local: {
    id: 'local',
    name: 'Local (whisper.cpp)',
    keyPrefixes: [],
    keyPrefixConfidence: 'none',
    defaultBaseUrl: '',
    defaultModel: 'base.en',
    modelHints: [],
    docsUrl: 'https://github.com/ggerganov/whisper.cpp',
  },
};

/**
 * Auto-detect STT provider from API key prefix.
 * Returns the provider ID or undefined if no match.
 * Checks longer prefixes first to avoid false matches
 * (e.g., `sk-or-` should match openrouter before `sk-` matches openai).
 */
export function detectProviderFromKey(apiKey: string): string | undefined {
  const matches: { prefix: string; id: string }[] = [];
  for (const [id, info] of Object.entries(STT_PROVIDERS)) {
    if (id === 'local') continue;
    for (const prefix of info.keyPrefixes) {
      if (apiKey.startsWith(prefix)) {
        matches.push({ prefix, id });
      }
    }
  }
  if (matches.length === 0) return undefined;
  matches.sort((a, b) => b.prefix.length - a.prefix.length);
  return matches[0]!.id;
}

/**
 * Auto-detect STT provider from base URL.
 * Returns the provider ID or undefined if no match.
 */
export function detectProviderFromUrl(baseUrl: string): string | undefined {
  const normalized = baseUrl.replace(/\/+$/, '');
  for (const [id, info] of Object.entries(STT_PROVIDERS)) {
    if (id === 'local') continue;
    const defaultUrl = info.defaultBaseUrl.replace(/\/+$/, '');
    if (normalized === defaultUrl) {
      return id;
    }
  }
  return undefined;
}

/**
 * Auto-detect STT provider from model name.
 * Returns the provider ID or undefined if no match.
 */
export function detectProviderFromModel(model: string): string | undefined {
  for (const [id, info] of Object.entries(STT_PROVIDERS)) {
    if (id === 'local') continue;
    for (const hint of info.modelHints) {
      if (model.includes(hint)) {
        return id;
      }
    }
  }
  return undefined;
}

/**
 * Get provider info by ID.
 */
export function getProviderInfo(id: string): SttProviderInfo | undefined {
  return STT_PROVIDERS[id];
}

/**
 * Get all non-local provider IDs.
 */
export function getProviderIds(): string[] {
  return Object.keys(STT_PROVIDERS).filter((id) => id !== 'local');
}

/**
 * Get all cloud (non-local) provider info entries.
 */
export function getCloudProviders(): SttProviderInfo[] {
  return Object.values(STT_PROVIDERS).filter((p) => p.id !== 'local');
}

/**
 * Get providers that have no detectable key prefix.
 * These are the only candidates for API key probing.
 */
export function getProbeableProviders(): SttProviderInfo[] {
  return Object.values(STT_PROVIDERS).filter(
    (p) => p.id !== 'local' && p.keyPrefixConfidence === 'none',
  );
}

/**
 * Probe a provider with an API key by hitting the /models endpoint.
 * Returns true if the key is valid (200 response).
 */
export async function probeProvider(apiKey: string, provider: SttProviderInfo): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${provider.defaultBaseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Cache entry for a detected provider.
 */
interface ProviderCacheEntry {
  provider: string;
  detectedAt: number;
  ttlMs: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCachePath(): string {
  const home = process.env['ECHOS_HOME'] ?? `${process.env['HOME'] ?? ''}/echos`;
  return `${home}/stt-provider-cache.json`;
}

function getCache(): Record<string, ProviderCacheEntry> {
  try {
    return JSON.parse(readFileSync(getCachePath(), 'utf-8'));
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, ProviderCacheEntry>): void {
  try {
    mkdirSync(dirname(getCachePath()), { recursive: true });
    writeFileSync(getCachePath(), JSON.stringify(cache, null, 2));
  } catch {
    // ignore write errors
  }
}

function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Load a cached provider for an API key.
 * Returns the provider ID if found and not expired, undefined otherwise.
 */
export function loadCachedProvider(apiKey: string): string | undefined {
  const cache = getCache();
  const entry = cache[hashApiKey(apiKey)];
  if (!entry) return undefined;

  if (Date.now() - entry.detectedAt > entry.ttlMs) {
    delete cache[hashApiKey(apiKey)];
    saveCache(cache);
    return undefined;
  }

  return entry.provider;
}

/**
 * Save a detected provider to cache.
 */
export function saveCachedProvider(apiKey: string, provider: string): void {
  const cache = getCache();
  cache[hashApiKey(apiKey)] = {
    provider,
    detectedAt: Date.now(),
    ttlMs: CACHE_TTL_MS,
  };
  saveCache(cache);
}
