/**
 * Unit + integration tests for setup-lib.ts and setup.ts (non-interactive mode).
 *
 * Run: pnpm vitest run scripts/
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as net from 'node:net';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseEnvFile,
  maskKey,
  quoteEnvValue,
  envLine,
  stateToEnv,
  checkNodeVersion,
  validateAnthropicKey,
  validateRedisUrl,
  writeEnvFile,
  createDataDirs,
  type WizardState,
} from './setup-lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolve tsx binary from workspace root node_modules (works when running from any CWD)
const TSX_BIN = path.resolve(__dirname, '..', 'node_modules', '.bin', 'tsx');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'echos-setup-test-'));
}

function baseState(overrides: Partial<WizardState> = {}): WizardState {
  return {
    anthropicApiKey: 'sk-ant-test123',
    openaiApiKey: '',
    allowedUserIds: '12345',
    enableTelegram: false,
    telegramBotToken: '',
    enableWeb: false,
    webPort: 3000,
    webApiKey: '',
    redisUrl: 'redis://localhost:6379',
    knowledgeDir: './data/knowledge',
    dbPath: './data/db',
    sessionDir: './data/sessions',
    defaultModel: 'claude-haiku-4-5-20251001',
    embeddingModel: 'text-embedding-3-small',
    webshareProxyUsername: '',
    webshareProxyPassword: '',
    ...overrides,
  };
}

// ─── parseEnvFile ────────────────────────────────────────────────────────────

describe('parseEnvFile', () => {
  it('parses key=value pairs', () => {
    const result = parseEnvFile('FOO=bar\nBAZ=qux');
    expect(result['FOO']).toBe('bar');
    expect(result['BAZ']).toBe('qux');
  });

  it('strips surrounding double quotes', () => {
    const result = parseEnvFile('KEY="hello world"');
    expect(result['KEY']).toBe('hello world');
  });

  it('strips surrounding single quotes', () => {
    const result = parseEnvFile("KEY='hello world'");
    expect(result['KEY']).toBe('hello world');
  });

  it('ignores comment lines', () => {
    const result = parseEnvFile('# comment\nFOO=bar\n  # another\nBAZ=qux');
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['FOO']).toBe('bar');
  });

  it('ignores blank lines', () => {
    const result = parseEnvFile('\n\nFOO=bar\n\n');
    expect(Object.keys(result)).toHaveLength(1);
  });

  it('handles = sign in value', () => {
    const result = parseEnvFile('JWT_SECRET=abc=def==');
    expect(result['JWT_SECRET']).toBe('abc=def==');
  });

  it('returns empty object for empty string', () => {
    expect(parseEnvFile('')).toEqual({});
  });
});

// ─── maskKey ─────────────────────────────────────────────────────────────────

describe('maskKey', () => {
  it('masks long key with prefix and suffix', () => {
    const masked = maskKey('sk-ant-abcdefghijklmnop');
    expect(masked).toBe('sk-ant...mnop');
    expect(masked).not.toContain('abcdefgh');
  });

  it('fully masks short key (≤8 chars)', () => {
    expect(maskKey('abc')).toBe('***');
    expect(maskKey('12345678')).toBe('********');
  });

  it('returns (empty) for empty string', () => {
    expect(maskKey('')).toBe('(empty)');
  });
});

// ─── quoteEnvValue / envLine ─────────────────────────────────────────────────

describe('quoteEnvValue', () => {
  it('returns plain value unchanged', () => {
    expect(quoteEnvValue('plainvalue')).toBe('plainvalue');
  });

  it('quotes values with spaces', () => {
    expect(quoteEnvValue('hello world')).toBe('"hello world"');
  });

  it('quotes values with #', () => {
    expect(quoteEnvValue('abc#def')).toBe('"abc#def"');
  });

  it('escapes double quotes inside quoted value', () => {
    const result = quoteEnvValue('say "hi"');
    expect(result).toBe('"say \\"hi\\""');
  });

  it('strips newlines to prevent env injection', () => {
    const result = quoteEnvValue('line1\nline2\r\nline3');
    expect(result).toBe('line1line2line3');
  });

  it('returns empty string for empty input', () => {
    expect(quoteEnvValue('')).toBe('');
  });
});

describe('envLine', () => {
  it('produces KEY=value for plain value', () => {
    expect(envLine('FOO', 'bar')).toBe('FOO=bar');
  });

  it('quotes value with spaces', () => {
    expect(envLine('MSG', 'hello world')).toBe('MSG="hello world"');
  });
});

// ─── stateToEnv ──────────────────────────────────────────────────────────────

describe('stateToEnv', () => {
  it('includes required keys', () => {
    const out = stateToEnv(baseState());
    expect(out).toContain('ANTHROPIC_API_KEY=sk-ant-test123');
    expect(out).toContain('ALLOWED_USER_IDS=12345');
    expect(out).toContain('REDIS_URL=redis://localhost:6379');
  });

  it('comments out optional empty fields', () => {
    const out = stateToEnv(baseState({ openaiApiKey: '' }));
    expect(out).toContain('# OPENAI_API_KEY=');
    expect(out).not.toMatch(/^OPENAI_API_KEY=/m);
  });

  it('includes optional key when set', () => {
    const out = stateToEnv(baseState({ openaiApiKey: 'sk-openai-abc' }));
    expect(out).toContain('OPENAI_API_KEY=sk-openai-abc');
  });

  it('comments out telegram token when empty', () => {
    const out = stateToEnv(baseState({ enableTelegram: false, telegramBotToken: '' }));
    expect(out).toContain('# TELEGRAM_BOT_TOKEN=');
  });

  it('produces valid content (no syntax errors)', () => {
    const state = baseState({
      openaiApiKey: 'sk-openai-test',
      enableTelegram: true,
      telegramBotToken: '123:token',
      enableWeb: true,
      webApiKey: 'myapikey',
    });
    const out = stateToEnv(state);
    // Should be parseable back
    const parsed = parseEnvFile(out);
    expect(parsed['ANTHROPIC_API_KEY']).toBe('sk-ant-test123');
    expect(parsed['TELEGRAM_BOT_TOKEN']).toBe('123:token');
  });
});

// ─── checkNodeVersion ────────────────────────────────────────────────────────

describe('checkNodeVersion', () => {
  it('passes on Node.js 20+', () => {
    const result = checkNodeVersion();
    // In CI and dev we run 20+
    expect(result.ok).toBe(true);
    expect(result.fatal).toBe(false);
  });

  it('fails on Node.js < 20', () => {
    const original = process.versions.node;
    Object.defineProperty(process.versions, 'node', { value: '18.20.0', configurable: true });
    try {
      const result = checkNodeVersion();
      expect(result.ok).toBe(false);
      expect(result.fatal).toBe(true);
      expect(result.message).toContain('18.20.0');
    } finally {
      Object.defineProperty(process.versions, 'node', { value: original, configurable: true });
    }
  });
});

// ─── validateAnthropicKey (fetch mocked) ─────────────────────────────────────

describe('validateAnthropicKey', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects keys not starting with sk-ant-', async () => {
    const result = await validateAnthropicKey('bad-key');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('sk-ant-');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns valid: true on HTTP 200', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ status: 200, ok: true } as Response);
    const result = await validateAnthropicKey('sk-ant-validkey');
    expect(result.valid).toBe(true);
  });

  it('returns valid: true on HTTP 400 (format error = key accepted)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ status: 400, ok: false } as Response);
    const result = await validateAnthropicKey('sk-ant-validkey');
    expect(result.valid).toBe(true);
  });

  it('returns valid: false on HTTP 401', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ status: 401, ok: false } as Response);
    const result = await validateAnthropicKey('sk-ant-validkey');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('401');
  });

  it('returns valid: false on network error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('fetch failed'));
    const result = await validateAnthropicKey('sk-ant-validkey');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Network error');
  });
});

// ─── validateRedisUrl (real TCP server) ──────────────────────────────────────

describe('validateRedisUrl', () => {
  it('returns valid: false for malformed URL', async () => {
    const result = await validateRedisUrl('not-a-url');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid URL');
  });

  it('returns valid: true when TCP server accepts connection', async () => {
    // Spin up a local TCP echo server
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    try {
      const result = await validateRedisUrl(`redis://127.0.0.1:${port}`);
      expect(result.valid).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('returns valid: false when connection is refused', async () => {
    // Find a free port, then close — nothing listening there
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const result = await validateRedisUrl(`redis://127.0.0.1:${port}`);
    expect(result.valid).toBe(false);
  });
});

// ─── writeEnvFile ────────────────────────────────────────────────────────────

describe('writeEnvFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .env file with content', () => {
    const envPath = path.join(tmpDir, '.env');
    writeEnvFile(baseState(), envPath);
    expect(fs.existsSync(envPath)).toBe(true);
    const content = fs.readFileSync(envPath, 'utf8');
    expect(content).toContain('ANTHROPIC_API_KEY=');
  });

  it('sets mode 0o600 on .env file', () => {
    const envPath = path.join(tmpDir, '.env');
    writeEnvFile(baseState(), envPath);
    const stat = fs.statSync(envPath);
    // eslint-disable-next-line no-bitwise
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('backs up existing .env before overwriting', () => {
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(envPath, 'EXISTING=yes', 'utf8');

    const { backupPath } = writeEnvFile(baseState(), envPath);
    expect(backupPath).toBeDefined();
    expect(fs.existsSync(backupPath!)).toBe(true);
    const backupContent = fs.readFileSync(backupPath!, 'utf8');
    expect(backupContent).toBe('EXISTING=yes');
  });

  it('returns undefined backupPath when no existing file', () => {
    const envPath = path.join(tmpDir, '.env');
    const { backupPath } = writeEnvFile(baseState(), envPath);
    expect(backupPath).toBeUndefined();
  });
});

// ─── createDataDirs ──────────────────────────────────────────────────────────

describe('createDataDirs', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates all three data directories', () => {
    createDataDirs(baseState(), tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'data', 'knowledge'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'data', 'db'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'data', 'sessions'))).toBe(true);
  });

  it('is idempotent (does not throw if dirs exist)', () => {
    createDataDirs(baseState(), tmpDir);
    expect(() => createDataDirs(baseState(), tmpDir)).not.toThrow();
  });
});

// ─── Integration: setup.ts --non-interactive ─────────────────────────────────

describe('setup.ts --non-interactive (subprocess)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits 0, writes .env, and creates data dirs', () => {
    const setupScript = path.join(__dirname, 'setup.ts');
    const result = spawnSync(
      TSX_BIN,
      [setupScript, '--non-interactive', '--skip-validation'],
      {
        cwd: tmpDir,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: 'sk-ant-test',
          ALLOWED_USER_IDS: '12345',
          REDIS_URL: 'redis://localhost:6379',
        },
        encoding: 'utf8',
        timeout: 30000,
      },
    );

    expect(result.status).toBe(0);

    const envPath = path.join(tmpDir, '.env');
    expect(fs.existsSync(envPath)).toBe(true);

    const content = fs.readFileSync(envPath, 'utf8');
    expect(content).toContain('ANTHROPIC_API_KEY=sk-ant-test');
    expect(content).toContain('ALLOWED_USER_IDS=12345');
    expect(content).toContain('REDIS_URL=redis://localhost:6379');

    // Verify file permissions
    const stat = fs.statSync(envPath);
    // eslint-disable-next-line no-bitwise
    expect(stat.mode & 0o777).toBe(0o600);

    // Verify data directories created
    expect(fs.existsSync(path.join(tmpDir, 'data', 'knowledge'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'data', 'db'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'data', 'sessions'))).toBe(true);
  });

  it('exits 1 when ANTHROPIC_API_KEY is missing', () => {
    const setupScript = path.join(__dirname, 'setup.ts');
    const result = spawnSync(
      TSX_BIN,
      [setupScript, '--non-interactive'],
      {
        cwd: tmpDir,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: '',
          ALLOWED_USER_IDS: '12345',
        },
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ANTHROPIC_API_KEY');
  });

  it('generates WEB_API_KEY when ENABLE_WEB=true and none provided', () => {
    const setupScript = path.join(__dirname, 'setup.ts');
    const result = spawnSync(
      TSX_BIN,
      [setupScript, '--non-interactive', '--skip-validation'],
      {
        cwd: tmpDir,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: 'sk-ant-test',
          ALLOWED_USER_IDS: '12345',
          ENABLE_WEB: 'true',
        },
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    expect(result.status).toBe(0);
    const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf8');
    // WEB_API_KEY should be a 64-char hex string
    expect(content).toMatch(/WEB_API_KEY=[0-9a-f]{64}/);
  });
});
