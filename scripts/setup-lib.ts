/**
 * EchOS Setup Library
 *
 * Pure functions extracted from setup.ts for testability.
 * Imported by both setup.ts and setup.test.ts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WizardState {
  anthropicApiKey: string;
  openaiApiKey: string;
  allowedUserIds: string;
  enableTelegram: boolean;
  telegramBotToken: string;
  enableWeb: boolean;
  webPort: number;
  webApiKey: string;
  redisUrl: string;
  knowledgeDir: string;
  dbPath: string;
  sessionDir: string;
  defaultModel: string;
  embeddingModel: string;
  webshareProxyUsername: string;
  webshareProxyPassword: string;
}

export interface PrereqResult {
  ok: boolean;
  message: string;
  fatal: boolean;
}

// ─── Prereq helpers ──────────────────────────────────────────────────────────

export function checkNodeVersion(): PrereqResult {
  const ver = process.versions.node;
  const major = parseInt(ver.split('.')[0]!, 10);
  if (major < 20) {
    return { ok: false, message: `Node.js ${ver} detected — requires 20+`, fatal: true };
  }
  return { ok: true, message: `Node.js ${ver}`, fatal: false };
}

export function checkPnpm(): PrereqResult {
  try {
    const out = execSync('pnpm --version', { stdio: 'pipe' }).toString().trim();
    const major = parseInt(out.split('.')[0]!, 10);
    if (major < 10) {
      return { ok: false, message: `pnpm ${out} detected — requires 10+`, fatal: true };
    }
    return { ok: true, message: `pnpm ${out}`, fatal: false };
  } catch {
    return { ok: false, message: 'pnpm not found — install via: npm install -g pnpm', fatal: true };
  }
}

export function checkDiskSpace(): PrereqResult {
  try {
    const out = execSync('df -k .', { stdio: 'pipe' }).toString().trim().split('\n');
    const line = out[1];
    if (line) {
      const cols = line.trim().split(/\s+/);
      const availKb = parseInt(cols[3] ?? '0', 10);
      const availMb = Math.round(availKb / 1024);
      if (availMb < 500) {
        return { ok: false, message: `Only ${availMb} MB free — recommend 500+ MB`, fatal: false };
      }
      return { ok: true, message: `${availMb} MB free`, fatal: false };
    }
  } catch {
    // ignore
  }
  return { ok: true, message: 'disk space check skipped', fatal: false };
}

// ─── API validation helpers ──────────────────────────────────────────────────

export async function validateAnthropicKey(key: string): Promise<{ valid: boolean; error?: string }> {
  if (!key.startsWith('sk-ant-')) {
    return { valid: false, error: 'Key should start with sk-ant-' };
  }
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });
    if (resp.status === 401) return { valid: false, error: 'API key rejected (401 Unauthorized)' };
    if (resp.status === 400 || resp.ok) return { valid: true };
    return { valid: false, error: `Unexpected status ${resp.status}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Network error: ${msg}` };
  }
}

export async function validateOpenAIKey(key: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const resp = await fetch('https://api.openai.com/v1/models', {
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${key}` },
    });
    if (resp.status === 401) return { valid: false, error: 'API key rejected (401 Unauthorized)' };
    if (resp.ok) return { valid: true };
    return { valid: false, error: `Unexpected status ${resp.status}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Network error: ${msg}` };
  }
}

export async function validateTelegramToken(
  token: string,
): Promise<{ valid: boolean; botName?: string; error?: string }> {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(10000),
    });
    const data = (await resp.json()) as { ok: boolean; result?: { username?: string } };
    if (data.ok) {
      return { valid: true, botName: data.result?.username };
    }
    return { valid: false, error: 'Bot token rejected by Telegram' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Network error: ${msg}` };
  }
}

export async function validateRedisUrl(url: string): Promise<{ valid: boolean; error?: string }> {
  const { createConnection } = await import('node:net');
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const port = parseInt(parsed.port || '6379', 10);
      const host = parsed.hostname || 'localhost';
      const conn = createConnection({ host, port, timeout: 5000 });
      conn.on('connect', () => {
        conn.destroy();
        resolve({ valid: true });
      });
      conn.on('error', (err) => resolve({ valid: false, error: err.message }));
      conn.on('timeout', () => {
        conn.destroy();
        resolve({ valid: false, error: `Connection to ${host}:${port} timed out` });
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      resolve({ valid: false, error: `Invalid URL: ${msg}` });
    }
  });
}

// ─── .env file helpers ───────────────────────────────────────────────────────

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    const value = raw.replace(/^(['"])(.*)\1$/, '$2');
    result[key] = value;
  }
  return result;
}

export function maskKey(key: string): string {
  if (!key) return '(empty)';
  if (key.length <= 8) return '*'.repeat(key.length);
  return key.slice(0, 6) + '...' + key.slice(-4);
}

/** Quote env values that contain special chars (spaces, #, quotes, newlines) */
export function quoteEnvValue(value: string): string {
  if (!value) return '';
  // Strip newlines/carriage returns to prevent env injection
  const sanitized = value.replace(/[\r\n]/g, '');
  // Quote if value contains spaces, #, ', or "
  if (/[\s#'"\\]/.test(sanitized)) {
    return `"${sanitized.replace(/["\\]/g, '\\$&')}"`;
  }
  return sanitized;
}

export function envLine(key: string, value: string): string {
  return `${key}=${quoteEnvValue(value)}`;
}

export function stateToEnv(state: WizardState): string {
  const lines: string[] = [
    '# EchOS Configuration — generated by pnpm wizard:cli',
    `# Created: ${new Date().toISOString()}`,
    '',
    '# ── Required ────────────────────────────────────────────────────────────────',
    envLine('ANTHROPIC_API_KEY', state.anthropicApiKey),
    envLine('ALLOWED_USER_IDS', state.allowedUserIds),
    '',
    '# ── OpenAI (optional, for embeddings and Whisper) ───────────────────────────',
    state.openaiApiKey ? envLine('OPENAI_API_KEY', state.openaiApiKey) : '# OPENAI_API_KEY=',
    '',
    '# ── Interfaces ───────────────────────────────────────────────────────────────',
    `ENABLE_TELEGRAM=${state.enableTelegram}`,
    `ENABLE_WEB=${state.enableWeb}`,
    `WEB_PORT=${state.webPort}`,
    state.webApiKey ? envLine('WEB_API_KEY', state.webApiKey) : '# WEB_API_KEY=',
    '',
    '# ── Telegram (required when ENABLE_TELEGRAM=true) ───────────────────────────',
    state.telegramBotToken
      ? envLine('TELEGRAM_BOT_TOKEN', state.telegramBotToken)
      : '# TELEGRAM_BOT_TOKEN=',
    '',
    '# ── Storage ──────────────────────────────────────────────────────────────────',
    envLine('KNOWLEDGE_DIR', state.knowledgeDir),
    envLine('DB_PATH', state.dbPath),
    envLine('SESSION_DIR', state.sessionDir),
    '',
    '# ── Redis (required) ─────────────────────────────────────────────────────────',
    envLine('REDIS_URL', state.redisUrl),
    '',
    '# ── Models ───────────────────────────────────────────────────────────────────',
    envLine('DEFAULT_MODEL', state.defaultModel),
    envLine('EMBEDDING_MODEL', state.embeddingModel),
    '',
    '# ── Webshare Proxy (optional, for YouTube on cloud IPs) ─────────────────────',
    state.webshareProxyUsername
      ? envLine('WEBSHARE_PROXY_USERNAME', state.webshareProxyUsername)
      : '# WEBSHARE_PROXY_USERNAME=',
    state.webshareProxyPassword
      ? envLine('WEBSHARE_PROXY_PASSWORD', state.webshareProxyPassword)
      : '# WEBSHARE_PROXY_PASSWORD=',
    '',
  ];
  return lines.join('\n');
}

// ─── Non-interactive mode ────────────────────────────────────────────────────

export function runNonInteractive(): WizardState {
  const e = process.env;

  const requiredKeys = ['ANTHROPIC_API_KEY', 'ALLOWED_USER_IDS'];
  const missing = requiredKeys.filter((k) => !e[k]);
  if (missing.length > 0) {
    console.error(
      `\nError: Missing required env vars for --non-interactive mode: ${missing.join(', ')}\n`,
    );
    process.exit(1);
  }

  return {
    anthropicApiKey: e['ANTHROPIC_API_KEY'] ?? '',
    openaiApiKey: e['OPENAI_API_KEY'] ?? '',
    allowedUserIds: e['ALLOWED_USER_IDS'] ?? '',
    enableTelegram: e['ENABLE_TELEGRAM'] === 'true',
    telegramBotToken: e['TELEGRAM_BOT_TOKEN'] ?? '',
    enableWeb: e['ENABLE_WEB'] === 'true',
    webPort: parseInt(e['WEB_PORT'] ?? '3000', 10),
    webApiKey:
      e['ENABLE_WEB'] === 'true'
        ? (e['WEB_API_KEY'] ?? randomBytes(32).toString('hex'))
        : (e['WEB_API_KEY'] ?? ''),
    redisUrl: e['REDIS_URL'] ?? 'redis://localhost:6379',
    knowledgeDir: e['KNOWLEDGE_DIR'] ?? './data/knowledge',
    dbPath: e['DB_PATH'] ?? './data/db',
    sessionDir: e['SESSION_DIR'] ?? './data/sessions',
    defaultModel: e['DEFAULT_MODEL'] ?? 'claude-haiku-4-5-20251001',
    embeddingModel: e['EMBEDDING_MODEL'] ?? 'text-embedding-3-small',
    webshareProxyUsername: e['WEBSHARE_PROXY_USERNAME'] ?? '',
    webshareProxyPassword: e['WEBSHARE_PROXY_PASSWORD'] ?? '',
  };
}

// ─── Write artifacts ─────────────────────────────────────────────────────────

/**
 * Write .env file at the given path (defaults to `.env` in CWD).
 * Returns the backup path if an existing file was backed up.
 */
export function writeEnvFile(
  state: WizardState,
  envPath?: string,
): { backupPath?: string } {
  const resolved = envPath ?? path.resolve('.env');
  let backupPath: string | undefined;

  if (fs.existsSync(resolved)) {
    backupPath = `${resolved}.backup.${Date.now()}`;
    fs.copyFileSync(resolved, backupPath);
  }

  const content = stateToEnv(state);
  fs.writeFileSync(resolved, content, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(resolved, 0o600);

  return { backupPath };
}

/**
 * Create data directories referenced in state.
 * Relative paths are resolved against `baseDir` (defaults to CWD).
 */
export function createDataDirs(state: WizardState, baseDir?: string): void {
  const base = baseDir ?? process.cwd();
  const dirs = [state.knowledgeDir, state.dbPath, state.sessionDir].map((d) =>
    path.isAbsolute(d) ? d : path.resolve(base, d),
  );
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
