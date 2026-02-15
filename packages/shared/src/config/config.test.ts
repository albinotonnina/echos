import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig, resetConfig } from './index.js';

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
    expect(config.knowledgeDir).toBe('./data/knowledge');
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
});
