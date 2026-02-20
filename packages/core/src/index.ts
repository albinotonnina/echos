export {
  createSqliteStorage,
  createMarkdownStorage,
  createVectorStorage,
  createSearchService,
  reconcileStorage,
  computeContentHash,
  createFileWatcher,
  createEmbeddingFn,
  type SqliteStorage,
  type MarkdownStorage,
  type VectorStorage,
  type VectorDocument,
  type VectorSearchResult,
  type VectorStorageOptions,
  type SearchService,
  type NoteRow,
  type ListNotesOptions,
  type FtsOptions,
  type ReconcileOptions,
  type ReconcileStats,
  type WatcherOptions,
  type FileWatcher,
  type EmbeddingOptions,
} from './storage/index.js';

export {
  createEchosAgent,
  SYSTEM_PROMPT,
  buildSystemPrompt,
  type AgentDeps,
} from './agent/index.js';
export { isAgentMessageOverflow } from './agent/context-manager.js';
export {
  createContextMessage,
  createUserMessage,
  type EchosContextMessage,
} from './agent/messages.js';
export {
  resolveModel,
  MODEL_PRESETS,
  MODEL_PRESET_NAMES,
  type ModelPreset,
} from './agent/model-resolver.js';
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
