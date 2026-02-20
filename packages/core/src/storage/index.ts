export { createSqliteStorage, type SqliteStorage, type NoteRow, type ListNotesOptions, type FtsOptions } from './sqlite.js';
export { createMarkdownStorage, type MarkdownStorage } from './markdown.js';
export { createVectorStorage, type VectorStorage, type VectorDocument, type VectorSearchResult } from './vectordb.js';
export { createSearchService, type SearchService } from './search.js';
export { reconcileStorage, computeContentHash, type ReconcileOptions, type ReconcileStats } from './reconciler.js';
export { createFileWatcher, type WatcherOptions, type FileWatcher } from './watcher.js';
export { createEmbeddingFn, type EmbeddingOptions } from './embeddings.js';
