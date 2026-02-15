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

export { createEchosAgent, SYSTEM_PROMPT, type AgentDeps } from './agent/index.js';
export { processArticle } from './processors/article.js';
export { processYoutube, extractVideoId } from './processors/youtube.js';
export { analyzeStyle, type StyleProfile } from './style/analyzer.js';
