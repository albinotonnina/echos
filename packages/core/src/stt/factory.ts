import type { Config } from '@echos/shared';
import { ValidationError } from '@echos/shared';
import type { SpeechToTextClient } from './index.js';
import { OpenAICompatibleClient } from './openai-compatible-client.js';
import { LocalWhisperClient } from './local-whisper-client.js';

export function createSttClient(config: Config): SpeechToTextClient | undefined {
  if (config.sttProvider === 'local') {
    if (!config.sttLocalCommand) {
      throw new ValidationError('STT_LOCAL_COMMAND is required when STT_PROVIDER=local');
    }
    return new LocalWhisperClient(
      config.sttLocalCommand,
      config.sttLocalModel ?? 'base.en',
      config.sttLocalModelDir,
    );
  }

  if (config.sttProvider === 'openai-compatible') {
    const apiKey = config.sttApiKey ?? config.openaiApiKey;
    if (!apiKey) {
      return undefined;
    }
    return new OpenAICompatibleClient(
      apiKey,
      config.sttBaseUrl ?? 'https://api.openai.com/v1',
      config.sttModel ?? 'whisper-1',
    );
  }

  return undefined;
}
