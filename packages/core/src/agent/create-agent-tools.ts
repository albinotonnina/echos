import type { Agent, AgentTool } from '@mariozechner/pi-agent-core';
import { buildSystemPrompt } from './system-prompt.js';
import {
  createNoteTool,
  searchKnowledgeTool,
  getNoteTool,
  listNotesTool,
  updateNoteTool,
  deleteNoteTool,
  restoreNoteTool,
  listTrashTool,
  addReminderTool,
  completeReminderTool,
  listRemindersTool,
  linkNotesTool,
  rememberAboutMeTool,
  recallKnowledgeTool,
  createCategorizeNoteTool,
  markContentTool,
  createSetAgentVoiceTool,
  createExportNotesTool,
  listTodosTool,
  createManageTagsTool,
  createReadingQueueTool,
  createReadingStatsTool,
  createKnowledgeStatsTool,
  saveConversationTool,
  createManageBackupsTool,
  noteHistoryTool,
  restoreVersionTool,
  createExploreGraphTool,
  findSimilarTool,
  createSuggestLinksTool,
  searchConversationsTool,
  createUseTemplateTool,
  createSynthesizeNotesTool,
} from './tools/index.js';
import { createRevisionStorage } from '../storage/revisions.js';
import type { AgentToolDeps } from './types.js';
import type { MemoryEntry } from '@echos/shared';

export interface CreateAgentToolsContext {
  deps: AgentToolDeps;
  memories: MemoryEntry[];
  hasMore: boolean;
  agentRef: { current: Agent | null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAgentTools(ctx: CreateAgentToolsContext): AgentTool<any>[] {
  const { deps, memories, hasMore, agentRef } = ctx;

  const revisions = createRevisionStorage(deps.sqlite.db);

  const storageDeps = {
    sqlite: deps.sqlite,
    markdown: deps.markdown,
    vectorDb: deps.vectorDb,
    generateEmbedding: deps.generateEmbedding,
  };

  return [
    createNoteTool(storageDeps),
    searchKnowledgeTool({
      search: deps.search,
      generateEmbedding: deps.generateEmbedding,
    }),
    getNoteTool({ sqlite: deps.sqlite, markdown: deps.markdown }),
    listNotesTool({ sqlite: deps.sqlite }),
    updateNoteTool({ ...storageDeps, revisions }),
    deleteNoteTool({
      sqlite: deps.sqlite,
      markdown: deps.markdown,
      vectorDb: deps.vectorDb,
    }),
    restoreNoteTool({
      sqlite: deps.sqlite,
      markdown: deps.markdown,
    }),
    listTrashTool({ sqlite: deps.sqlite }),
    addReminderTool({ sqlite: deps.sqlite }),
    completeReminderTool({ sqlite: deps.sqlite }),
    listRemindersTool({ sqlite: deps.sqlite }),
    listTodosTool({ sqlite: deps.sqlite }),
    linkNotesTool({ sqlite: deps.sqlite, markdown: deps.markdown }),
    markContentTool({ sqlite: deps.sqlite, markdown: deps.markdown }),
    rememberAboutMeTool({ sqlite: deps.sqlite }),
    recallKnowledgeTool({ sqlite: deps.sqlite }),
    createCategorizeNoteTool({
      ...storageDeps,
      ...(deps.anthropicApiKey !== undefined ? { anthropicApiKey: deps.anthropicApiKey } : {}),
      ...(deps.llmApiKey !== undefined ? { llmApiKey: deps.llmApiKey } : {}),
      ...(deps.llmBaseUrl !== undefined ? { llmBaseUrl: deps.llmBaseUrl } : {}),
      ...(deps.modelId !== undefined ? { modelId: deps.modelId } : {}),
      logger: deps.logger,
    }),
    createSetAgentVoiceTool({
      sqlite: deps.sqlite,
      onVoiceChange: (instruction) => {
        if (agentRef.current) {
          const newPrompt = buildSystemPrompt(memories, hasMore, instruction || null);
          agentRef.current.state.systemPrompt = newPrompt;
        }
      },
    }),
    createExportNotesTool({
      sqlite: deps.sqlite,
      markdown: deps.markdown,
      exportsDir: deps.exportsDir,
    }),
    createManageTagsTool({ sqlite: deps.sqlite, markdown: deps.markdown }),
    createReadingQueueTool({ sqlite: deps.sqlite }),
    createReadingStatsTool({ sqlite: deps.sqlite }),
    createKnowledgeStatsTool({
      sqlite: deps.sqlite,
      knowledgeDir: deps.knowledgeDir,
      dbPath: deps.dbPath,
    }),
    saveConversationTool(storageDeps),
    ...(deps.backupConfig
      ? [
          createManageBackupsTool({
            backupConfig: deps.backupConfig,
            retentionCount: deps.backupRetentionCount,
          }),
        ]
      : []),
    noteHistoryTool({ sqlite: deps.sqlite, revisions }),
    restoreVersionTool({ ...storageDeps, revisions }),
    createExploreGraphTool({
      sqlite: deps.sqlite,
      search: deps.search,
      generateEmbedding: deps.generateEmbedding,
    }),
    findSimilarTool(storageDeps),
    createSuggestLinksTool({
      sqlite: deps.sqlite,
      vectorDb: deps.vectorDb,
      generateEmbedding: deps.generateEmbedding,
    }),
    searchConversationsTool({
      search: deps.search,
      generateEmbedding: deps.generateEmbedding,
    }),
    createUseTemplateTool({
      sqlite: deps.sqlite,
      markdown: deps.markdown,
      vectorDb: deps.vectorDb,
      generateEmbedding: deps.generateEmbedding,
      knowledgeDir: deps.knowledgeDir,
    }),
    createSynthesizeNotesTool({
      sqlite: deps.sqlite,
      markdown: deps.markdown,
      vectorDb: deps.vectorDb,
      search: deps.search,
      generateEmbedding: deps.generateEmbedding,
      ...(deps.anthropicApiKey !== undefined ? { anthropicApiKey: deps.anthropicApiKey } : {}),
      ...(deps.llmApiKey !== undefined ? { llmApiKey: deps.llmApiKey } : {}),
      ...(deps.llmBaseUrl !== undefined ? { llmBaseUrl: deps.llmBaseUrl } : {}),
      ...(deps.modelId !== undefined ? { modelId: deps.modelId } : {}),
      logger: deps.logger,
    }),
  ];
}
