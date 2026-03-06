#!/usr/bin/env -S pnpm tsx

/**
 * EchOS Interactive Setup Wizard
 *
 * Usage:
 *   pnpm wizard:cli                        # interactive
 *   pnpm wizard:cli --non-interactive      # CI mode (reads env vars, writes .env)
 *   pnpm wizard:cli --skip-validation      # skip live API key checks
 *   pnpm wizard:cli --check-only           # prerequisite checks only
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as clack from '@clack/prompts';
import pc from 'picocolors';
import {
  type WizardState,
  type PrereqResult,
  checkNodeVersion,
  checkPnpm,
  checkDiskSpace,
  validateAnthropicKey,
  validateOpenAIKey,
  validateTelegramToken,
  validateRedisUrl,
  parseEnvFile,
  maskKey,
  runNonInteractive,
  writeEnvFile,
  createDataDirs,
} from './setup-lib.js';

// ─── CLI flag parsing ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const NON_INTERACTIVE = args.includes('--non-interactive');
const SKIP_VALIDATION = args.includes('--skip-validation') || NON_INTERACTIVE;
const CHECK_ONLY = args.includes('--check-only');

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

  // ── Step 2: Telegram ─────────────────────────────────────────────────────

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

  // ── Step 3: Allowed User IDs ─────────────────────────────────────────────

  clack.log.step('Security — Allowed Users');
  if (enableTelegram) {
    clack.log.info(pc.dim('Get your Telegram user ID by messaging @userinfobot on Telegram'));
  }

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

  // ── Step 4: Other Interfaces ─────────────────────────────────────────────

  clack.log.step('Additional Interfaces');
  clack.log.warn(
    pc.yellow('Web UI is') +
    pc.bold(pc.yellow(' experimental')) +
    pc.yellow(' and disabled by default.\n') +
    pc.dim('  Telegram is the recommended interface. Use `pnpm echos` for CLI/terminal access.'),
  );

  const interfaceChoices = await clack.multiselect<string, string>({
    message: 'Enable interfaces (optional)',
    options: [
      {
        value: 'web',
        label: 'Web UI',
        hint: 'experimental — REST API + web interface (requires API key auth)',
      },
    ],
    initialValues: [...(existing['ENABLE_WEB'] === 'true' ? ['web'] : [])],
    required: false,
  });
  if (clack.isCancel(interfaceChoices)) cancel();
  const ifaces = interfaceChoices as string[];
  const enableWeb = ifaces.includes('web');

  // Generate or reuse API key for web interface
  const { randomBytes } = await import('node:crypto');
  const webApiKey = enableWeb ? (existing['WEB_API_KEY'] ?? randomBytes(32).toString('hex')) : '';

  if (enableWeb) {
    clack.log.info(
      pc.dim('Web API key (') +
      pc.bold('keep this secret') +
      pc.dim(', stored in .env):') +
      '\n  ' +
      pc.cyan(webApiKey),
    );
  }

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

  // ── Step 5: Redis ───────────────────────────────────────────────────────

  clack.log.step('Redis (required)');

  clack.log.info(
    pc.dim('Redis is required for background jobs (digests, reminders, cron).\nInstall commands (if not already running):') +
    '\n  ' +
    pc.cyan('macOS :') +
    '  brew install redis && brew services start redis' +
    '\n  ' +
    pc.cyan('Ubuntu:') +
    '  sudo apt install redis-server && sudo systemctl enable --now redis' +
    '\n  ' +
    pc.cyan('Docker:') +
    '  docker run -d -p 6379:6379 --name redis redis:7-alpine',
  );

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
  const redisUrl = (redisRaw as string).trim();

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
    webPort,
    webApiKey,
    redisUrl,
    knowledgeDir,
    dbPath,
    sessionDir,
    defaultModel: existing['DEFAULT_MODEL'] ?? 'claude-haiku-4-5-20251001',
    embeddingModel: existing['EMBEDDING_MODEL'] ?? 'text-embedding-3-small',
    webshareProxyUsername: existing['WEBSHARE_PROXY_USERNAME'] ?? '',
    webshareProxyPassword: existing['WEBSHARE_PROXY_PASSWORD'] ?? '',
  };
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
      pc.bgCyan(pc.black(' EchOS Setup Wizard ')) + pc.dim('  — estimated time: 3-5 minutes'),
    );
    clack.log.info(pc.dim('No changes will be made until you confirm at the summary step.'));
  }

  // ── Prerequisite checks ─────────────────────────────────────────────────

  if (!NON_INTERACTIVE) {
    const spin = clack.spinner();
    spin.start('Checking prerequisites…');

    const checks: PrereqResult[] = [
      checkNodeVersion(),
      checkPnpm(),
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
      `Web UI           : ${state.enableWeb ? pc.green(`enabled :${state.webPort}`) + pc.dim(` (key: ${state.webApiKey.slice(0, 8)}…)`) : pc.dim('disabled (experimental)')}`,
      `CLI              : ${pc.green('always available')} ${pc.dim('— run `pnpm echos` anytime')}`,
      `Redis            : ${pc.green(state.redisUrl)}`,
      `Storage          : ${state.knowledgeDir}, ${state.dbPath}, ${state.sessionDir}`,
    ].join('\n  ');

    clack.log.message(`  ${summary}`);

    const confirm = await clack.confirm({ message: 'Write .env and create data directories?' });
    if (clack.isCancel(confirm) || !confirm) cancel();
  }

  // ── Write artifacts ──────────────────────────────────────────────────────

  const writeSpin = NON_INTERACTIVE ? null : clack.spinner();
  writeSpin?.start('Writing .env…');

  const { backupPath } = writeEnvFile(state);
  if (backupPath) {
    clack.log.info(`Backed up existing .env to ${path.basename(backupPath)}`);
  }
  createDataDirs(state);

  writeSpin?.stop(pc.green('.env written (mode 0600) and data directories created'));

  if (NON_INTERACTIVE) {
    console.log('.env written successfully');
  }

  // ── Build offer ──────────────────────────────────────────────────────────

  if (!NON_INTERACTIVE) {
    const distDirs = [
      'packages/shared/dist',
      'packages/core/dist',
      'plugins/content-creation/dist',
      'plugins/youtube/dist',
      'plugins/article/dist',
      'plugins/image/dist',
    ];
    const hasDist = distDirs.every((d) => fs.existsSync(path.resolve(d)));
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
