#!/usr/bin/env node

/**
 * EchOS CLI — standalone three-mode terminal interface.
 *
 * No daemon required. Connects directly to ./data/ alongside any running daemon.
 *
 *   One-shot:    echos "find my TypeScript notes"
 *   Pipe:        cat file.md | echos
 *   Interactive: echos  (TTY readline REPL with history)
 */

import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createLogger } from '@echos/shared';
import {
  createEchosAgent,
  createContextMessage,
  createUserMessage,
  createSqliteStorage,
  createMarkdownStorage,
  createVectorStorage,
  createSearchService,
} from '@echos/core';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeContextMessage() {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return createContextMessage(
    `Current date/time: ${now.toISOString()} (${now.toLocaleString('en-US', { timeZone: tz })} ${tz})`,
  );
}

// ── CLI ────────────────────────────────────────────────────────────────────

async function runCli(): Promise<void> {
  const dbPath = process.env['DB_PATH'] ?? './data/db';
  const knowledgeDir = process.env['KNOWLEDGE_DIR'] ?? './data/knowledge';
  const anthropicApiKey = process.env['ANTHROPIC_API_KEY'];

  if (!anthropicApiKey) {
    process.stderr.write('Error: ANTHROPIC_API_KEY environment variable is required.\n');
    process.exit(1);
  }

  const logger = createLogger('echos-cli', process.env['LOG_LEVEL'] ?? 'warn');

  const sqlite = createSqliteStorage(join(dbPath, 'echos.db'), logger);
  const markdown = createMarkdownStorage(knowledgeDir, logger);
  const vectorDb = await createVectorStorage(join(dbPath, 'vectors'), logger);
  const search = createSearchService(sqlite, vectorDb, markdown, logger);
  const generateEmbedding = async (_text: string): Promise<number[]> => new Array(1536).fill(0);

  const agent = createEchosAgent({
    sqlite,
    markdown,
    vectorDb,
    search,
    generateEmbedding,
    anthropicApiKey,
    ...(process.env['DEFAULT_MODEL'] ? { modelId: process.env['DEFAULT_MODEL'] } : {}),
    logger,
  });
  agent.sessionId = 'cli-local';

  const isTTY = Boolean(process.stdout.isTTY);
  const useColors = isTTY && process.stdout.hasColors();
  const dim = (s: string): string => (useColors ? `\x1b[2m${s}\x1b[0m` : s);

  let cancelled = false;
  let inFlight = false;

  const unsubscribe = agent.subscribe((event) => {
    if (cancelled) return;
    if (event.type === 'message_update' && 'assistantMessageEvent' in event) {
      const ame = event.assistantMessageEvent;
      if (ame.type === 'text_delta') {
        process.stdout.write(ame.delta);
      }
    }
    if (event.type === 'tool_execution_start') {
      process.stdout.write(dim(`\n[${event.toolName}] `));
    }
    if (event.type === 'agent_end') {
      process.stdout.write(isTTY ? '\n' + '─'.repeat(40) + '\n' : '\n');
    }
  });

  const cleanup = (): void => {
    unsubscribe();
    sqlite.close();
    vectorDb.close();
  };

  const send = async (text: string): Promise<void> => {
    cancelled = false;
    inFlight = true;
    try {
      await agent.prompt([makeContextMessage(), createUserMessage(text)]);
    } finally {
      inFlight = false;
    }
  };

  // ── Mode detection ────────────────────────────────────────────────────────

  const argInput = process.argv.slice(2).join(' ').trim();
  const hasPipedInput = !process.stdin.isTTY;

  // ── One-shot mode ─────────────────────────────────────────────────────────

  if (argInput) {
    try {
      await send(argInput);
    } finally {
      cleanup();
    }
    return;
  }

  // ── Pipe mode ─────────────────────────────────────────────────────────────

  if (hasPipedInput) {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
        chunks.push(chunk);
      }
      const stdinText = Buffer.concat(chunks).toString('utf8').trim();
      if (stdinText) {
        await send(stdinText);
      }
    } finally {
      cleanup();
    }
    return;
  }

  // ── Interactive REPL ──────────────────────────────────────────────────────

  const historyFile = join(homedir(), '.echos_history');
  const MAX_HISTORY = 500;

  let savedHistory: string[] = [];
  if (existsSync(historyFile)) {
    try {
      savedHistory = readFileSync(historyFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .slice(-MAX_HISTORY)
        .reverse();
    } catch {
      // ignore read errors
    }
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    historySize: MAX_HISTORY,
    history: savedHistory,
    terminal: true,
  });

  const saveHistory = (): void => {
    try {
      const rlInternal = rl as unknown as { history: string[] };
      const lines = (rlInternal.history ?? []).slice(0, MAX_HISTORY).reverse();
      writeFileSync(historyFile, lines.join('\n') + '\n', 'utf8');
    } catch {
      // ignore write errors
    }
  };



  const asciiArt = [
    '      ___          ______      _          ____    _____ ',
    '     /   \\        |  ____|    | |        / __ \\  / ____|',
    '    / /_\\ \\       | |__   ___ | |__     | |  | || (___  ',
    '    \\  _  /       |  __| / __|| \'_ \\    | |  | | \\___ \\ ',
    '     \\/ \\/        | |___| (__ | | | |   | |__| | ____) |',
    '      ___         |______\\___||_| |_|    \\____/ |_____/ ',
    '                                                        ',
    ' [ SYSTEM READY ] ----------------------- [ MEMORY: ON ]'
  ].join('\n');



  let version = 'unknown';
  try {
    const pkgPath = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    version = pkg.version;
  } catch {
    // ignore
  }

  const welcomeMsg = `\nWelcome to EchOS CLI v${version}.\nType your message below. (Ctrl+C cancels response, Ctrl+D or "exit" to quit)\n\n`;
  const colorfulArt = useColors ? `\x1b[36m${asciiArt}\x1b[0m` : asciiArt;

  process.stdout.write(colorfulArt + welcomeMsg);

  process.on('SIGINT', () => {
    if (inFlight) {
      cancelled = true;
      agent.abort();
      process.stdout.write('\n^C\n');
      rl.prompt();
    } else {
      process.stdout.write('\n');
      saveHistory();
      cleanup();
      process.exit(0);
    }
  });

  rl.setPrompt('> ');
  rl.prompt();

  rl.on('line', (input) => {
    const trimmed = (input as string).trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }
    if (trimmed === 'exit' || trimmed === 'quit') {
      saveHistory();
      cleanup();
      rl.close();
      return;
    }
    rl.pause();
    void send(trimmed)
      .then(() => {
        rl.resume();
        if (!cancelled) {
          rl.prompt();
        } else {
          cancelled = false;
        }
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'send failed');
        cancelled = false;
        rl.resume();
        rl.prompt();
      });
  });

  rl.on('close', () => {
    saveHistory();
    cleanup();
    process.exit(0);
  });
}

runCli().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
