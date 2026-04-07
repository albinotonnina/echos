import type { Config } from '@echos/shared';
import { ValidationError } from '@echos/shared';
import type { SpeechToTextClient } from './index.js';
import { OpenAICompatibleClient } from './openai-compatible-client.js';
import { LocalWhisperClient } from './local-whisper-client.js';
import {
  detectProviderFromKey,
  detectProviderFromModel,
  detectProviderFromUrl,
  getProviderInfo,
  getProbeableProviders,
  probeProvider,
  loadCachedProvider,
  saveCachedProvider,
  STT_PROVIDERS,
} from './registry.js';

export async function createSttClient(config: Config): Promise<SpeechToTextClient | undefined> {
  if (config.sttProvider === 'local') {
    return createLocalClient(config);
  }

  if (config.sttProvider !== 'auto') {
    return createCloudClient(config);
  }

  const apiKey = config.sttApiKey ?? config.openaiApiKey;
  if (!apiKey) {
    return undefined;
  }

  const detectedProvider = await detectProvider(config, apiKey);
  if (detectedProvider) {
    return createClientWithProvider(detectedProvider, apiKey, config);
  }

  const cached = loadCachedProvider(apiKey);
  if (cached) {
    return createClientWithProvider(cached, apiKey, config);
  }

  // Probe providers with opaque keys (Together AI, SiliconFlow, etc.)
  const probed = await probeSttProviders(apiKey);
  if (probed) {
    return createClientWithProvider(probed.provider, apiKey, config);
  }

  return undefined;
}

async function detectProvider(config: Config, apiKey: string): Promise<string | undefined> {
  if (config.sttBaseUrl) {
    const fromUrl = detectProviderFromUrl(config.sttBaseUrl);
    if (fromUrl && fromUrl !== 'local') return fromUrl;
  }

  if (config.sttModel) {
    const fromModel = detectProviderFromModel(config.sttModel);
    if (fromModel && fromModel !== 'local') return fromModel;
  }

  const fromKey = detectProviderFromKey(apiKey);
  if (fromKey && fromKey !== 'local') return fromKey;

  return undefined;
}

function createClientWithProvider(
  providerId: string,
  apiKey: string,
  config: Config,
): SpeechToTextClient | undefined {
  const info = STT_PROVIDERS[providerId];
  if (!info) {
    return undefined;
  }

  const baseUrl = config.sttBaseUrl ?? info.defaultBaseUrl;
  const model = config.sttModel ?? info.defaultModel;

  return new OpenAICompatibleClient(apiKey, baseUrl, model);
}

function createLocalClient(config: Config): SpeechToTextClient {
  if (!config.sttLocalCommand) {
    throw new ValidationError('STT_LOCAL_COMMAND is required when STT_PROVIDER=local');
  }
  return new LocalWhisperClient(
    config.sttLocalCommand,
    config.sttLocalModel ?? 'base.en',
    config.sttLocalModelDir,
  );
}

function createCloudClient(config: Config): SpeechToTextClient | undefined {
  const apiKey = config.sttApiKey ?? config.openaiApiKey;
  if (!apiKey) {
    return undefined;
  }

  const info = getProviderInfo(config.sttProvider);
  if (!info) {
    throw new ValidationError(`Unknown STT provider: ${config.sttProvider}`);
  }

  const baseUrl = config.sttBaseUrl ?? info.defaultBaseUrl;
  const model = config.sttModel ?? info.defaultModel;

  return new OpenAICompatibleClient(apiKey, baseUrl, model);
}

/**
 * Probe all STT providers with the given API key.
 * Returns the first provider that accepts the key, or undefined if none do.
 * Caches the result for 24 hours.
 * Only probes providers with no detectable key prefix.
 */
export async function probeSttProviders(
  apiKey: string,
): Promise<{ provider: string; baseUrl: string; model: string } | undefined> {
  const providers = getProbeableProviders();

  for (const info of providers) {
    const isValid = await probeProvider(apiKey, info);
    if (isValid) {
      saveCachedProvider(apiKey, info.id);
      return {
        provider: info.id,
        baseUrl: info.defaultBaseUrl,
        model: info.defaultModel,
      };
    }
  }

  return undefined;
}
