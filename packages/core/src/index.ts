export {
  createSqliteStorage,
  createMarkdownStorage,
  createVectorStorage,
  createSearchService,
  type SqliteStorage,
  type MarkdownStorage,
  type VectorStorage,
  type VectorDocument,
  type VectorSearchResult,
  type SearchService,
  type NoteRow,
  type ListNotesOptions,
  type FtsOptions,
} from './storage/index.js';

export { createEchosAgent, SYSTEM_PROMPT, buildSystemPrompt, type AgentDeps } from './agent/index.js';
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
