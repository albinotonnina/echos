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
import { writeFile, copyFile } from 'node:fs/promises';
import { createLogger } from '@echos/shared';
import type { ExportFileResult } from '@echos/core';
import {
  createEchosAgent,
  createContextMessage,
  createUserMessage,
  createSqliteStorage,
  createMarkdownStorage,
  createVectorStorage,
  createSearchService,
  PluginRegistry,
} from '@echos/core';
import articlePlugin from '@echos/plugin-article';
import youtubePlugin from '@echos/plugin-youtube';
import twitterPlugin from '@echos/plugin-twitter';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Insert a numeric suffix before the extension: foo.zip → foo-2.zip */
function suffixPath(p: string, n: number): string {
  const dot = p.lastIndexOf('.');
  return dot >= 0 ? `${p.slice(0, dot)}-${n}${p.slice(dot)}` : `${p}-${n}`;
}

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

  // Register plugins so the CLI has save_article, save_youtube, save_tweet tools
  const pluginRegistry = new PluginRegistry(logger);
  pluginRegistry.register(articlePlugin);
  pluginRegistry.register(youtubePlugin);
  pluginRegistry.register(twitterPlugin);

  await pluginRegistry.setupAll({
    sqlite,
    markdown,
    vectorDb,
    generateEmbedding,
    logger,
    getAgentDeps: () => undefined as never,
    getNotificationService: () => ({
      async sendMessage() {},
      async broadcast() {},
    }),
    config: {
      ...(anthropicApiKey ? { anthropicApiKey } : {}),
      ...(process.env['OPENAI_API_KEY'] ? { openaiApiKey: process.env['OPENAI_API_KEY'] } : {}),
      knowledgeDir,
      ...(process.env['DEFAULT_MODEL'] ? { defaultModel: process.env['DEFAULT_MODEL'] } : {}),
    },
  });

  const agent = createEchosAgent({
    sqlite,
    markdown,
    vectorDb,
    search,
    generateEmbedding,
    anthropicApiKey,
    ...(process.env['DEFAULT_MODEL'] ? { modelId: process.env['DEFAULT_MODEL'] } : {}),
    logger,
    pluginTools: pluginRegistry.getTools(),
  });
  agent.sessionId = 'cli-local';

  const isTTY = Boolean(process.stdout.isTTY);
  const useColors = isTTY && process.stdout.hasColors();
  const dim = (s: string): string => (useColors ? `\x1b[2m${s}\x1b[0m` : s);

  // ── Argument parsing (--output / -o) ──────────────────────────────────────

  const rawArgs = process.argv.slice(2);
  let outputPath: string | undefined;
  const promptArgs: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
    if ((arg === '--output' || arg === '-o') && i + 1 < rawArgs.length) {
      outputPath = rawArgs[i + 1];
      i++;
    } else {
      promptArgs.push(arg);
    }
  }

  let cancelled = false;
  let inFlight = false;

  const pendingExports: ExportFileResult[] = [];

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
    if (event.type === 'tool_execution_end' && !event.isError && event.toolName === 'export_notes') {
      try {
        const resultContent = (
          event.result as { content?: Array<{ type: string; text?: string }> } | undefined
        )?.content;
        const textContent = resultContent?.find((c) => c.type === 'text');
        if (textContent?.text) {
          const parsed = JSON.parse(textContent.text) as ExportFileResult;
          if (parsed.type === 'export_file') {
            pendingExports.push(parsed);
          }
        }
      } catch {
        // ignore
      }
    }
  });

  const processPendingExports = async (): Promise<void> => {
    for (let i = 0; i < pendingExports.length; i++) {
      const exportResult = pendingExports[i]!;
      try {
        if (exportResult.inline !== undefined) {
          if (outputPath) {
            const dest = pendingExports.length > 1 ? suffixPath(outputPath, i + 1) : outputPath;
            await writeFile(dest, exportResult.inline, 'utf8');
            process.stderr.write(`Exported to: ${dest}\n`);
          } else {
            process.stdout.write(exportResult.inline);
          }
        } else if (exportResult.filePath) {
          const base = outputPath ?? join(process.cwd(), exportResult.fileName);
          const dest = outputPath && pendingExports.length > 1 ? suffixPath(base, i + 1) : base;
          await copyFile(exportResult.filePath, dest);
          process.stderr.write(`Exported to: ${dest}\n`);
        }
      } catch (err: unknown) {
        process.stderr.write(`Export delivery failed: ${String(err)}\n`);
      }
    }
    pendingExports.length = 0;
  };

  const cleanup = (): void => {
    unsubscribe();
    void pluginRegistry.teardownAll();
    sqlite.close();
    vectorDb.close();
  };

  const send = async (text: string): Promise<void> => {
    cancelled = false;
    inFlight = true;
    try {
      await agent.prompt([makeContextMessage(), createUserMessage(text)]);
      await processPendingExports();
    } finally {
      inFlight = false;
    }
  };

  // ── Mode detection ────────────────────────────────────────────────────────

  const argInput = promptArgs.join(' ').trim();
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
