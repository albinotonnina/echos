import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig, resetConfig, ECHOS_HOME } from './index.js';
import { join } from 'node:path';

afterEach(() => {
  resetConfig();
});

const validEnv = {
  TELEGRAM_BOT_TOKEN: 'test-token',
  ALLOWED_USER_IDS: '123,456',
  ANTHROPIC_API_KEY: 'sk-test',
};

describe('loadConfig', () => {
  it('should load valid config with required fields', () => {
    const config = loadConfig(validEnv);
    expect(config.telegramBotToken).toBe('test-token');
    expect(config.allowedUserIds).toEqual([123, 456]);
    expect(config.anthropicApiKey).toBe('sk-test');
  });

  it('should apply defaults for optional fields', () => {
    const config = loadConfig(validEnv);
    expect(config.redisUrl).toBe('redis://localhost:6379');
    expect(config.knowledgeDir).toBe(join(ECHOS_HOME, 'knowledge'));
    expect(config.dbPath).toBe(join(ECHOS_HOME, 'db'));
    expect(config.sessionDir).toBe(join(ECHOS_HOME, 'sessions'));
    expect(config.enableTelegram).toBe(true);
    expect(config.enableWeb).toBe(false);
    expect(config.webPort).toBe(3000);
  });

  it('should throw on missing required fields', () => {
    expect(() => loadConfig({})).toThrow('Invalid configuration');
  });

  it('should parse comma-separated user IDs', () => {
    const config = loadConfig({ ...validEnv, ALLOWED_USER_IDS: '1, 2, 3' });
    expect(config.allowedUserIds).toEqual([1, 2, 3]);
  });

  it('should accept LLM_API_KEY without ANTHROPIC_API_KEY', () => {
    // DEFAULT_MODEL must be a non-Anthropic model; otherwise pickApiKey() will throw at agent creation.
    const env = { ALLOWED_USER_IDS: '123', LLM_API_KEY: 'gsk_test', DEFAULT_MODEL: 'groq/llama-3.3-70b-versatile' };
    const config = loadConfig(env);
    expect(config.llmApiKey).toBe('gsk_test');
    expect(config.defaultModel).toBe('groq/llama-3.3-70b-versatile');
    expect(config.anthropicApiKey).toBeUndefined();
  });

  it('should throw when neither ANTHROPIC_API_KEY nor LLM_API_KEY is set', () => {
    expect(() => loadConfig({ ALLOWED_USER_IDS: '123' })).toThrow('Invalid configuration');
  });

  it('should throw when LLM_BASE_URL is set without LLM_API_KEY', () => {
    expect(() =>
      loadConfig({ ALLOWED_USER_IDS: '123', LLM_BASE_URL: 'https://api.deepinfra.com/v1/openai' }),
    ).toThrow('Invalid configuration');
  });

  it('should accept LLM_BASE_URL together with LLM_API_KEY', () => {
    // DEFAULT_MODEL is the model ID forwarded as-is to the custom endpoint.
    const env = {
      ALLOWED_USER_IDS: '123',
      LLM_API_KEY: 'di_test',
      LLM_BASE_URL: 'https://api.deepinfra.com/v1/openai',
      DEFAULT_MODEL: 'meta-llama/Meta-Llama-3.1-70B-Instruct',
    };
    const config = loadConfig(env);
    expect(config.llmApiKey).toBe('di_test');
    expect(config.llmBaseUrl).toBe('https://api.deepinfra.com/v1/openai');
    expect(config.defaultModel).toBe('meta-llama/Meta-Llama-3.1-70B-Instruct');
  });

  it('defaults cacheRetention to long', () => {
    const config = loadConfig(validEnv);
    expect(config.cacheRetention).toBe('long');
  });

  it('accepts cacheRetention values', () => {
    for (const v of ['none', 'short', 'long'] as const) {
      resetConfig();
      const config = loadConfig({ ...validEnv, CACHE_RETENTION: v });
      expect(config.cacheRetention).toBe(v);
    }
  });

  it('resolves ECHOS_HOME from env parameter for storage defaults', () => {
    const config = loadConfig({ ...validEnv, ECHOS_HOME: '/tmp/custom-echos' });
    expect(config.knowledgeDir).toBe('/tmp/custom-echos/knowledge');
    expect(config.dbPath).toBe('/tmp/custom-echos/db');
    expect(config.sessionDir).toBe('/tmp/custom-echos/sessions');
  });
});
