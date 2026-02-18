#!/usr/bin/env pnpm tsx

/**
 * EchOS Interactive Setup Wizard
 *
 * Usage:
 *   pnpm setup                        # interactive
 *   pnpm setup --non-interactive      # CI mode (reads env vars, writes .env)
 *   pnpm setup --skip-validation      # skip live API key checks
 *   pnpm setup --check-only           # prerequisite checks only
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import * as clack from '@clack/prompts';
import pc from 'picocolors';

// ─── CLI flag parsing ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const NON_INTERACTIVE = args.includes('--non-interactive');
const SKIP_VALIDATION = args.includes('--skip-validation') || NON_INTERACTIVE;
const CHECK_ONLY = args.includes('--check-only');

// ─── Types ───────────────────────────────────────────────────────────────────

interface WizardState {
  anthropicApiKey: string;
  openaiApiKey: string;
  allowedUserIds: string;
  enableTelegram: boolean;
  telegramBotToken: string;
  enableWeb: boolean;
  enableTui: boolean;
  webPort: number;
  enableScheduler: boolean;
  redisUrl: string;
  digestSchedule: string;
  reminderCheckSchedule: string;
  newsletterSchedule: string;
  trendingSchedule: string;
  knowledgeDir: string;
  dbPath: string;
  sessionDir: string;
  defaultModel: string;
  embeddingModel: string;
  webshareProxyUsername: string;
  webshareProxyPassword: string;
}

interface PrereqResult {
  ok: boolean;
  message: string;
  fatal: boolean;
}

// ─── Prereq helpers ──────────────────────────────────────────────────────────

function checkNodeVersion(): PrereqResult {
  const ver = process.versions.node;
  const major = parseInt(ver.split('.')[0]!, 10);
  if (major < 20) {
    return { ok: false, message: `Node.js ${ver} detected — requires 20+`, fatal: true };
  }
  return { ok: true, message: `Node.js ${ver}`, fatal: false };
}

function checkPnpm(): PrereqResult {
  try {
    const out = execSync('pnpm --version', { stdio: 'pipe' }).toString().trim();
    const major = parseInt(out.split('.')[0]!, 10);
    if (major < 9) {
      return { ok: false, message: `pnpm ${out} detected — requires 9+`, fatal: true };
    }
    return { ok: true, message: `pnpm ${out}`, fatal: false };
  } catch {
    return { ok: false, message: 'pnpm not found — install via: npm install -g pnpm', fatal: true };
  }
}

function checkPython(): PrereqResult {
  try {
    execSync('python3 -c "from youtube_transcript_api import YouTubeTranscriptApi"', { stdio: 'pipe' });
    return { ok: true, message: 'youtube-transcript-api available', fatal: false };
  } catch {
    return {
      ok: false,
      message: 'youtube-transcript-api not found (YouTube plugin will fail) — run: pip3 install youtube-transcript-api',
      fatal: false,
    };
  }
}

function checkDiskSpace(): PrereqResult {
  try {
    // df -k returns 1K blocks; check current directory
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

async function validateAnthropicKey(key: string): Promise<{ valid: boolean; error?: string }> {
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

async function validateOpenAIKey(key: string): Promise<{ valid: boolean; error?: string }> {
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

async function validateTelegramToken(token: string): Promise<{ valid: boolean; botName?: string; error?: string }> {
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

async function validateRedisUrl(url: string): Promise<{ valid: boolean; error?: string }> {
  // Simple TCP connectivity check via Node's net module
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

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes
    const value = raw.replace(/^(['"])(.*)\1$/, '$2');
    result[key] = value;
  }
  return result;
}

function maskKey(key: string): string {
  if (!key) return '(empty)';
  if (key.length <= 8) return '*'.repeat(key.length);
  return key.slice(0, 6) + '...' + key.slice(-4);
}

function stateToEnv(state: WizardState): string {
  const lines: string[] = [
    '# EchOS Configuration — generated by pnpm setup',
    `# Created: ${new Date().toISOString()}`,
    '',
    '# ── Required ────────────────────────────────────────────────────────────────',
    `ANTHROPIC_API_KEY=${state.anthropicApiKey}`,
    `ALLOWED_USER_IDS=${state.allowedUserIds}`,
    '',
    '# ── OpenAI (optional, for embeddings and Whisper) ───────────────────────────',
    state.openaiApiKey ? `OPENAI_API_KEY=${state.openaiApiKey}` : '# OPENAI_API_KEY=',
    '',
    '# ── Interfaces ───────────────────────────────────────────────────────────────',
    `ENABLE_TELEGRAM=${state.enableTelegram}`,
    `ENABLE_WEB=${state.enableWeb}`,
    `ENABLE_TUI=${state.enableTui}`,
    `WEB_PORT=${state.webPort}`,
    '',
    '# ── Telegram (required when ENABLE_TELEGRAM=true) ───────────────────────────',
    state.telegramBotToken
      ? `TELEGRAM_BOT_TOKEN=${state.telegramBotToken}`
      : '# TELEGRAM_BOT_TOKEN=',
    '',
    '# ── Storage ──────────────────────────────────────────────────────────────────',
    `KNOWLEDGE_DIR=${state.knowledgeDir}`,
    `DB_PATH=${state.dbPath}`,
    `SESSION_DIR=${state.sessionDir}`,
    '',
    '# ── Scheduler (requires Redis) ───────────────────────────────────────────────',
    `ENABLE_SCHEDULER=${state.enableScheduler}`,
    `REDIS_URL=${state.redisUrl}`,
    state.digestSchedule ? `DIGEST_SCHEDULE=${state.digestSchedule}` : '# DIGEST_SCHEDULE=',
    state.reminderCheckSchedule
      ? `REMINDER_CHECK_SCHEDULE=${state.reminderCheckSchedule}`
      : '# REMINDER_CHECK_SCHEDULE=',
    state.newsletterSchedule
      ? `NEWSLETTER_SCHEDULE=${state.newsletterSchedule}`
      : '# NEWSLETTER_SCHEDULE=',
    state.trendingSchedule ? `TRENDING_SCHEDULE=${state.trendingSchedule}` : '# TRENDING_SCHEDULE=',
    '',
    '# ── Models ───────────────────────────────────────────────────────────────────',
    `DEFAULT_MODEL=${state.defaultModel}`,
    `EMBEDDING_MODEL=${state.embeddingModel}`,
    '',
    '# ── Webshare Proxy (optional, for YouTube on cloud IPs) ─────────────────────',
    state.webshareProxyUsername
      ? `WEBSHARE_PROXY_USERNAME=${state.webshareProxyUsername}`
      : '# WEBSHARE_PROXY_USERNAME=',
    state.webshareProxyPassword
      ? `WEBSHARE_PROXY_PASSWORD=${state.webshareProxyPassword}`
      : '# WEBSHARE_PROXY_PASSWORD=',
    '',
  ];
  return lines.join('\n');
}

// ─── Non-interactive mode ────────────────────────────────────────────────────

function runNonInteractive(): WizardState {
  const e = process.env;

  const requiredKeys = ['ANTHROPIC_API_KEY', 'ALLOWED_USER_IDS'];
  const missing = requiredKeys.filter((k) => !e[k]);
  if (missing.length > 0) {
    console.error(`\nError: Missing required env vars for --non-interactive mode: ${missing.join(', ')}\n`);
    process.exit(1);
  }

  return {
    anthropicApiKey: e['ANTHROPIC_API_KEY'] ?? '',
    openaiApiKey: e['OPENAI_API_KEY'] ?? '',
    allowedUserIds: e['ALLOWED_USER_IDS'] ?? '',
    enableTelegram: e['ENABLE_TELEGRAM'] === 'true',
    telegramBotToken: e['TELEGRAM_BOT_TOKEN'] ?? '',
    enableWeb: e['ENABLE_WEB'] !== 'false',
    enableTui: e['ENABLE_TUI'] === 'true',
    webPort: parseInt(e['WEB_PORT'] ?? '3000', 10),
    enableScheduler: e['ENABLE_SCHEDULER'] === 'true',
    redisUrl: e['REDIS_URL'] ?? 'redis://localhost:6379',
    digestSchedule: e['DIGEST_SCHEDULE'] ?? '',
    reminderCheckSchedule: e['REMINDER_CHECK_SCHEDULE'] ?? '',
    newsletterSchedule: e['NEWSLETTER_SCHEDULE'] ?? '',
    trendingSchedule: e['TRENDING_SCHEDULE'] ?? '',
    knowledgeDir: e['KNOWLEDGE_DIR'] ?? './data/knowledge',
    dbPath: e['DB_PATH'] ?? './data/db',
    sessionDir: e['SESSION_DIR'] ?? './data/sessions',
    defaultModel: e['DEFAULT_MODEL'] ?? 'claude-3-5-haiku-20241022',
    embeddingModel: e['EMBEDDING_MODEL'] ?? 'text-embedding-3-small',
    webshareProxyUsername: e['WEBSHARE_PROXY_USERNAME'] ?? '',
    webshareProxyPassword: e['WEBSHARE_PROXY_PASSWORD'] ?? '',
  };
}

// ─── Main wizard ─────────────────────────────────────────────────────────────

async function runInteractiveWizard(existing: Record<string, string>): Promise<WizardState> {
  // ── Step 1: API Keys ──────────────────────────────────────────────────────

  clack.log.step('API Keys');

  const anthropicApiKey = await clack.password({
    message: `Anthropic API key ${pc.dim('(required — starts with sk-ant-)')}`,
    validate: (v) => {
      if (!v) return 'Required';
      if (!v.startsWith('sk-ant-')) return 'Key should start with sk-ant-';
    },
  });
  if (clack.isCancel(anthropicApiKey)) cancel();

  if (!SKIP_VALIDATION) {
    const spin = clack.spinner();
    spin.start('Validating Anthropic key…');
    const result = await validateAnthropicKey(anthropicApiKey as string);
    if (result.valid) {
      spin.stop(pc.green('✓ Anthropic key valid'));
    } else {
      spin.stop(pc.yellow(`⚠ Validation failed: ${result.error}`));
      const proceed = await clack.confirm({ message: 'Continue anyway?' });
      if (clack.isCancel(proceed) || !proceed) cancel();
    }
  }

  const openaiRaw = await clack.password({
    message: `OpenAI API key ${pc.dim('(optional — press Enter to skip)')}`,
  });
  if (clack.isCancel(openaiRaw)) cancel();
  const openaiApiKey = (openaiRaw as string).trim();

  if (openaiApiKey && !SKIP_VALIDATION) {
    const spin = clack.spinner();
    spin.start('Validating OpenAI key…');
    const result = await validateOpenAIKey(openaiApiKey);
    if (result.valid) {
      spin.stop(pc.green('✓ OpenAI key valid'));
    } else {
      spin.stop(pc.yellow(`⚠ Validation failed: ${result.error}`));
    }
  }

  // ── Step 2: Allowed User IDs ─────────────────────────────────────────────

  clack.log.step('Security — Allowed Users');
  clack.log.info(pc.dim('Get your Telegram user ID by messaging @userinfobot on Telegram'));

  const allowedUserIds = await clack.text({
    message: 'Allowed user IDs',
    placeholder: '123456789,987654321',
    initialValue: existing['ALLOWED_USER_IDS'] ?? '',
    validate: (v) => {
      if (!v.trim()) return 'At least one user ID is required';
      const ids = v.split(',').map((s) => s.trim());
      for (const id of ids) {
        if (!/^\d+$/.test(id)) return `Invalid user ID: "${id}" — must be a positive integer`;
      }
    },
  });
  if (clack.isCancel(allowedUserIds)) cancel();

  // ── Step 3: Telegram ─────────────────────────────────────────────────────

  clack.log.step('Telegram Interface');

  const enableTelegramBool = await clack.confirm({
    message: 'Enable Telegram bot?',
    initialValue: existing['ENABLE_TELEGRAM'] !== 'false',
  });
  if (clack.isCancel(enableTelegramBool)) cancel();
  const enableTelegram = enableTelegramBool as boolean;

  let telegramBotToken = '';
  if (enableTelegram) {
    const rawToken = await clack.password({
      message: `Telegram bot token ${pc.dim('(from @BotFather)')}`,
      validate: (v) => {
        if (!v) return 'Required when Telegram is enabled';
        if (!v.includes(':')) return 'Token format looks invalid (should contain :)';
      },
    });
    if (clack.isCancel(rawToken)) cancel();
    telegramBotToken = (rawToken as string).trim();

    if (!SKIP_VALIDATION) {
      const spin = clack.spinner();
      spin.start('Validating bot token with Telegram…');
      const result = await validateTelegramToken(telegramBotToken);
      if (result.valid) {
        spin.stop(pc.green(`✓ Connected as @${result.botName}`));
      } else {
        spin.stop(pc.yellow(`⚠ Validation failed: ${result.error}`));
        const proceed = await clack.confirm({ message: 'Continue anyway?' });
        if (clack.isCancel(proceed) || !proceed) cancel();
      }
    }
  }

  // ── Step 4: Other Interfaces ─────────────────────────────────────────────

  clack.log.step('Additional Interfaces');

  const interfaceChoices = await clack.multiselect<string, string>({
    message: 'Enable interfaces',
    options: [
      { value: 'web', label: 'Web UI', hint: 'REST/SSE API + web interface' },
      { value: 'tui', label: 'TUI', hint: 'terminal user interface' },
    ],
    initialValues: [
      ...(existing['ENABLE_WEB'] !== 'false' ? ['web'] : []),
      ...(existing['ENABLE_TUI'] === 'true' ? ['tui'] : []),
    ],
    required: false,
  });
  if (clack.isCancel(interfaceChoices)) cancel();
  const ifaces = interfaceChoices as string[];
  const enableWeb = ifaces.includes('web');
  const enableTui = ifaces.includes('tui');

  let webPort = 3000;
  if (enableWeb) {
    const portRaw = await clack.text({
      message: 'Web UI port',
      initialValue: existing['WEB_PORT'] ?? '3000',
      validate: (v) => {
        const n = parseInt(v, 10);
        if (isNaN(n) || n < 1 || n > 65535) return 'Must be a number between 1 and 65535';
      },
    });
    if (clack.isCancel(portRaw)) cancel();
    webPort = parseInt(portRaw as string, 10);
  }

  // ── Step 5: Scheduler ────────────────────────────────────────────────────

  clack.log.step('Background Scheduler');

  const enableSchedulerBool = await clack.confirm({
    message: 'Enable Redis background scheduler?',
    initialValue: existing['ENABLE_SCHEDULER'] === 'true',
  });
  if (clack.isCancel(enableSchedulerBool)) cancel();
  const enableScheduler = enableSchedulerBool as boolean;

  let redisUrl = 'redis://localhost:6379';
  let digestSchedule = '';
  let reminderCheckSchedule = '';
  let newsletterSchedule = '';
  let trendingSchedule = '';

  if (enableScheduler) {
    const redisRaw = await clack.text({
      message: 'Redis URL',
      initialValue: existing['REDIS_URL'] ?? 'redis://localhost:6379',
      validate: (v) => {
        try {
          new URL(v);
        } catch {
          return 'Invalid URL';
        }
      },
    });
    if (clack.isCancel(redisRaw)) cancel();
    redisUrl = (redisRaw as string).trim();

    if (!SKIP_VALIDATION) {
      const spin = clack.spinner();
      spin.start('Checking Redis connectivity…');
      const result = await validateRedisUrl(redisUrl);
      if (result.valid) {
        spin.stop(pc.green('✓ Redis reachable'));
      } else {
        spin.stop(pc.yellow(`⚠ Could not connect: ${result.error}`));
        const proceed = await clack.confirm({ message: 'Continue anyway?' });
        if (clack.isCancel(proceed) || !proceed) cancel();
      }
    }

    clack.log.info(pc.dim('Cron schedules — leave blank to disable. Reference: https://crontab.guru'));

    const digestRaw = await clack.text({
      message: `Daily digest cron ${pc.dim('(e.g. 0 8 * * * for 8am daily)')}`,
      initialValue: existing['DIGEST_SCHEDULE'] ?? '',
    });
    if (clack.isCancel(digestRaw)) cancel();
    digestSchedule = (digestRaw as string).trim();

    const reminderRaw = await clack.text({
      message: `Reminder check cron ${pc.dim('(e.g. */15 * * * * for every 15min)')}`,
      initialValue: existing['REMINDER_CHECK_SCHEDULE'] ?? '',
    });
    if (clack.isCancel(reminderRaw)) cancel();
    reminderCheckSchedule = (reminderRaw as string).trim();

    const newsletterRaw = await clack.text({
      message: `Newsletter cron ${pc.dim('(optional)')}`,
      initialValue: existing['NEWSLETTER_SCHEDULE'] ?? '',
    });
    if (clack.isCancel(newsletterRaw)) cancel();
    newsletterSchedule = (newsletterRaw as string).trim();

    const trendingRaw = await clack.text({
      message: `Trending topics cron ${pc.dim('(optional)')}`,
      initialValue: existing['TRENDING_SCHEDULE'] ?? '',
    });
    if (clack.isCancel(trendingRaw)) cancel();
    trendingSchedule = (trendingRaw as string).trim();
  }

  // ── Step 6: Storage ──────────────────────────────────────────────────────

  clack.log.step('Storage Paths');

  const customStorageBool = await clack.confirm({
    message: `Use default storage paths? ${pc.dim('(./data/knowledge, ./data/db, ./data/sessions)')}`,
    initialValue: true,
  });
  if (clack.isCancel(customStorageBool)) cancel();

  let knowledgeDir = './data/knowledge';
  let dbPath = './data/db';
  let sessionDir = './data/sessions';

  if (!(customStorageBool as boolean)) {
    const kdRaw = await clack.text({
      message: 'Knowledge directory',
      initialValue: existing['KNOWLEDGE_DIR'] ?? './data/knowledge',
    });
    if (clack.isCancel(kdRaw)) cancel();
    knowledgeDir = (kdRaw as string).trim();

    const dbRaw = await clack.text({
      message: 'Database directory',
      initialValue: existing['DB_PATH'] ?? './data/db',
    });
    if (clack.isCancel(dbRaw)) cancel();
    dbPath = (dbRaw as string).trim();

    const sessRaw = await clack.text({
      message: 'Sessions directory',
      initialValue: existing['SESSION_DIR'] ?? './data/sessions',
    });
    if (clack.isCancel(sessRaw)) cancel();
    sessionDir = (sessRaw as string).trim();
  }

  return {
    anthropicApiKey: anthropicApiKey as string,
    openaiApiKey,
    allowedUserIds: allowedUserIds as string,
    enableTelegram,
    telegramBotToken,
    enableWeb,
    enableTui,
    webPort,
    enableScheduler,
    redisUrl,
    digestSchedule,
    reminderCheckSchedule,
    newsletterSchedule,
    trendingSchedule,
    knowledgeDir,
    dbPath,
    sessionDir,
    defaultModel: existing['DEFAULT_MODEL'] ?? 'claude-3-5-haiku-20241022',
    embeddingModel: existing['EMBEDDING_MODEL'] ?? 'text-embedding-3-small',
    webshareProxyUsername: existing['WEBSHARE_PROXY_USERNAME'] ?? '',
    webshareProxyPassword: existing['WEBSHARE_PROXY_PASSWORD'] ?? '',
  };
}

// ─── Write artifacts ─────────────────────────────────────────────────────────

function writeEnvFile(state: WizardState): void {
  const envPath = path.resolve('.env');

  // Backup existing .env
  if (fs.existsSync(envPath)) {
    const backupPath = `${envPath}.backup.${Date.now()}`;
    fs.copyFileSync(envPath, backupPath);
    clack.log.info(`Backed up existing .env to ${path.basename(backupPath)}`);
  }

  const content = stateToEnv(state);
  fs.writeFileSync(envPath, content, { encoding: 'utf8', mode: 0o600 });
  // Ensure mode is set (writeFileSync mode may be ignored in some environments)
  fs.chmodSync(envPath, 0o600);
}

function createDataDirs(state: WizardState): void {
  const dirs = [state.knowledgeDir, state.dbPath, state.sessionDir];
  for (const dir of dirs) {
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cancel(): never {
  clack.cancel('Setup cancelled');
  process.exit(0);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!NON_INTERACTIVE) {
    clack.intro(
      pc.bgCyan(pc.black(' EchOS Setup Wizard ')) +
        pc.dim('  — estimated time: 3-5 minutes'),
    );
    clack.log.info(
      pc.dim('No changes will be made until you confirm at the summary step.'),
    );
  }

  // ── Prerequisite checks ─────────────────────────────────────────────────

  if (!NON_INTERACTIVE) {
    const spin = clack.spinner();
    spin.start('Checking prerequisites…');

    const checks: PrereqResult[] = [
      checkNodeVersion(),
      checkPnpm(),
      checkPython(),
      checkDiskSpace(),
    ];

    spin.stop('Prerequisites checked');

    let hasFatal = false;
    for (const check of checks) {
      if (check.ok) {
        clack.log.success(check.message);
      } else if (check.fatal) {
        clack.log.error(check.message);
        hasFatal = true;
      } else {
        clack.log.warn(check.message);
      }
    }

    if (hasFatal) {
      clack.outro(pc.red('Setup cannot continue. Fix the errors above and try again.'));
      process.exit(1);
    }
  }

  if (CHECK_ONLY) {
    clack.outro('Prerequisite check complete.');
    process.exit(0);
  }

  // ── Detect existing .env ─────────────────────────────────────────────────

  const envPath = path.resolve('.env');
  let existing: Record<string, string> = {};
  let envAction: 'update' | 'replace' | 'skip' = 'update';

  if (fs.existsSync(envPath) && !NON_INTERACTIVE) {
    const rawEnv = fs.readFileSync(envPath, 'utf8');
    existing = parseEnvFile(rawEnv);

    const action = await clack.select({
      message: '.env file already exists — what would you like to do?',
      options: [
        { value: 'update', label: 'Update', hint: 'pre-fill from existing values (recommended)' },
        { value: 'replace', label: 'Replace', hint: 'start fresh (existing values lost)' },
        { value: 'skip', label: 'Skip', hint: 'exit without changes' },
      ],
    });
    if (clack.isCancel(action)) cancel();
    envAction = action as 'update' | 'replace' | 'skip';

    if (envAction === 'skip') {
      clack.outro('No changes made.');
      process.exit(0);
    }

    if (envAction === 'replace') {
      existing = {};
    }
  }

  // ── Run wizard or non-interactive ────────────────────────────────────────

  let state: WizardState;
  if (NON_INTERACTIVE) {
    state = runNonInteractive();
  } else {
    state = await runInteractiveWizard(existing);
  }

  // ── Summary review ───────────────────────────────────────────────────────

  if (!NON_INTERACTIVE) {
    clack.log.step('Summary — review before writing');

    const summary = [
      `Anthropic key    : ${maskKey(state.anthropicApiKey)}`,
      `OpenAI key       : ${state.openaiApiKey ? maskKey(state.openaiApiKey) : pc.dim('(not set)')}`,
      `Allowed user IDs : ${state.allowedUserIds}`,
      `Telegram         : ${state.enableTelegram ? pc.green('enabled') : pc.dim('disabled')}${state.telegramBotToken ? ` (${maskKey(state.telegramBotToken)})` : ''}`,
      `Web UI           : ${state.enableWeb ? pc.green(`enabled :${state.webPort}`) : pc.dim('disabled')}`,
      `TUI              : ${state.enableTui ? pc.green('enabled') : pc.dim('disabled')}`,
      `Scheduler        : ${state.enableScheduler ? pc.green(`enabled — ${state.redisUrl}`) : pc.dim('disabled')}`,
      `Storage          : ${state.knowledgeDir}, ${state.dbPath}, ${state.sessionDir}`,
    ].join('\n  ');

    clack.log.message(`  ${summary}`);

    const confirm = await clack.confirm({ message: 'Write .env and create data directories?' });
    if (clack.isCancel(confirm) || !confirm) cancel();
  }

  // ── Write artifacts ──────────────────────────────────────────────────────

  const writeSpin = NON_INTERACTIVE ? null : clack.spinner();
  writeSpin?.start('Writing .env…');

  writeEnvFile(state);
  createDataDirs(state);

  writeSpin?.stop(pc.green('.env written (mode 0600) and data directories created'));

  if (NON_INTERACTIVE) {
    console.log('.env written successfully');
  }

  // ── Build offer ──────────────────────────────────────────────────────────

  if (!NON_INTERACTIVE) {
    const hasDist = fs.existsSync(path.resolve('packages/shared/dist'));
    if (!hasDist) {
      const buildNow = await clack.confirm({
        message: 'No build found. Run pnpm build now?',
        initialValue: true,
      });
      if (!clack.isCancel(buildNow) && buildNow) {
        const buildSpin = clack.spinner();
        buildSpin.start('Building all packages (this may take a minute)…');
        const result = spawnSync('pnpm', ['build'], { stdio: 'inherit' });
        if (result.status === 0) {
          buildSpin.stop(pc.green('Build complete'));
        } else {
          buildSpin.stop(pc.yellow('Build finished with errors — check output above'));
        }
      }
    }

    clack.outro(
      pc.green('Setup complete!') +
        '\n\n' +
        '  Next steps:\n' +
        pc.cyan('    pnpm start') +
        '                  — start EchOS\n' +
        pc.cyan('    pnpm start | pnpm exec pino-pretty') +
        '  — start with pretty logs\n',
    );
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nSetup failed: ${msg}\n`);
  process.exit(1);
});
