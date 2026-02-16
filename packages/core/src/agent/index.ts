import { Agent } from '@mariozechner/pi-agent-core';
import { getModel } from '@mariozechner/pi-ai';
import type { Logger } from 'pino';
import { SYSTEM_PROMPT } from './system-prompt.js';
import {
  createNoteTool,
  searchKnowledgeTool,
  getNoteTool,
  listNotesTool,
  updateNoteTool,
  deleteNoteTool,
  saveArticleTool,
  saveYoutubeTool,
  addReminderTool,
  completeReminderTool,
  linkNotesTool,
  rememberAboutMeTool,
  recallKnowledgeTool,
} from './tools/index.js';
import type { SqliteStorage } from '../storage/sqlite.js';
import type { MarkdownStorage } from '../storage/markdown.js';
import type { VectorStorage } from '../storage/vectordb.js';
import type { SearchService } from '../storage/search.js';

export interface AgentDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
  vectorDb: VectorStorage;
  search: SearchService;
  generateEmbedding: (text: string) => Promise<number[]>;
  modelId?: string;
  logger: Logger;
  openaiApiKey?: string;
}

export function createEchosAgent(deps: AgentDeps): Agent {
  const model = getModel(
    'anthropic',
    (deps.modelId ?? 'claude-sonnet-4-5-20250929') as 'claude-sonnet-4-5-20250929',
  );

  const storageDeps = {
    sqlite: deps.sqlite,
    markdown: deps.markdown,
    vectorDb: deps.vectorDb,
    generateEmbedding: deps.generateEmbedding,
  };

  const tools = [
    createNoteTool(storageDeps),
    searchKnowledgeTool({
      search: deps.search,
      generateEmbedding: deps.generateEmbedding,
    }),
    getNoteTool({ sqlite: deps.sqlite, markdown: deps.markdown }),
    listNotesTool({ sqlite: deps.sqlite }),
    updateNoteTool(storageDeps),
    deleteNoteTool({
      sqlite: deps.sqlite,
      markdown: deps.markdown,
      vectorDb: deps.vectorDb,
    }),
    saveArticleTool({ ...storageDeps, logger: deps.logger }),
    saveYoutubeTool({
      ...storageDeps,
      logger: deps.logger,
      ...(deps.openaiApiKey ? { openaiApiKey: deps.openaiApiKey } : {}),
    }),
    addReminderTool({ sqlite: deps.sqlite }),
    completeReminderTool({ sqlite: deps.sqlite }),
    linkNotesTool({ sqlite: deps.sqlite, markdown: deps.markdown }),
    rememberAboutMeTool({ sqlite: deps.sqlite }),
    recallKnowledgeTool({ sqlite: deps.sqlite }),
  ];

  deps.logger.info({ model: model.id, toolCount: tools.length }, 'Creating EchOS agent');

  return new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model,
      tools,
      thinkingLevel: 'off',
    },
  });
}

export { SYSTEM_PROMPT } from './system-prompt.js';
