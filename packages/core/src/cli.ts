#!/usr/bin/env node

/**
 * CLI test script for EchOS agent.
 * Usage: npx tsx packages/core/src/cli.ts "Create a note about TypeScript"
 */

import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createLogger } from '@echos/shared';
import { createSqliteStorage } from './storage/sqlite.js';
import { createMarkdownStorage } from './storage/markdown.js';
import { createVectorStorage } from './storage/vectordb.js';
import { createSearchService } from './storage/search.js';
import { createEchosAgent } from './agent/index.js';

const logger = createLogger('echos-cli');

const DATA_DIR = process.env['DATA_DIR'] ?? './data';

async function main(): Promise<void> {
  logger.info('Starting EchOS CLI...');

  const sqlite = createSqliteStorage(join(DATA_DIR, 'db', 'echos.db'), logger);
  const markdown = createMarkdownStorage(join(DATA_DIR, 'knowledge'), logger);
  const vectorDb = await createVectorStorage(join(DATA_DIR, 'db', 'vectors'), logger);
  const search = createSearchService(sqlite, vectorDb, markdown, logger);

  // Stub embedding function (returns zero vector if no OpenAI key)
  const generateEmbedding = async (text: string): Promise<number[]> => {
    logger.debug({ textLength: text.length }, 'Generating embedding (stub)');
    return new Array(1536).fill(0);
  };

  const agent = createEchosAgent({
    sqlite,
    markdown,
    vectorDb,
    search,
    generateEmbedding,
    logger,
  });

  // Handle events
  const unsubscribe = agent.subscribe((event) => {
    if (event.type === 'message_update' && 'assistantMessageEvent' in event) {
      const ame = event.assistantMessageEvent;
      if (ame.type === 'text_delta') {
        process.stdout.write(ame.delta);
      }
    }
    if (event.type === 'tool_execution_start') {
      console.log(`\n[Tool: ${event.toolName}]`);
    }
    if (event.type === 'agent_end') {
      console.log('\n');
    }
  });

  // Single prompt mode
  const promptArg = process.argv.slice(2).join(' ');
  if (promptArg) {
    await agent.prompt(promptArg);
    unsubscribe();
    sqlite.close();
    vectorDb.close();
    return;
  }

  // Interactive mode
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log('EchOS CLI (type "exit" to quit)\n');

  const askQuestion = (): void => {
    rl.question('> ', async (input) => {
      const trimmed = input.trim();
      if (trimmed === 'exit' || trimmed === 'quit') {
        unsubscribe();
        sqlite.close();
        vectorDb.close();
        rl.close();
        return;
      }
      if (!trimmed) {
        askQuestion();
        return;
      }
      await agent.prompt(trimmed);
      askQuestion();
    });
  };

  askQuestion();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
