export {
  createSqliteStorage,
  createMarkdownStorage,
  createVectorStorage,
  createSearchService,
  reconcileStorage,
  computeContentHash,
  createFileWatcher,
  type SqliteStorage,
  type MarkdownStorage,
  type VectorStorage,
  type VectorDocument,
  type VectorSearchResult,
  type SearchService,
  type NoteRow,
  type ListNotesOptions,
  type FtsOptions,
  type ReconcileOptions,
  type ReconcileStats,
  type WatcherOptions,
  type FileWatcher,
} from './storage/index.js';

export { createEchosAgent, SYSTEM_PROMPT, buildSystemPrompt, type AgentDeps } from './agent/index.js';
export { isAgentMessageOverflow } from './agent/context-manager.js';
export { createContextMessage, createUserMessage, type EchosContextMessage } from './agent/messages.js';
export {
  categorizeContent,
  categorizeLightweight,
  processFull,
  type CategorizationResult,
  type FullProcessingResult,
  type ProcessingMode,
} from './agent/categorization.js';
export { PluginRegistry, type EchosPlugin, type PluginContext } from './plugins/index.js';
export { analyzeStyle, type StyleProfile } from './style/analyzer.js';
export { computeSessionUsage, type SessionUsage } from './agent/usage-tracker.js';
