# EchOS Implementation — Agent Task Breakdown

Every task in this document is designed to be executed by an AI coding agent autonomously. Each task includes: what to build, which files to create/modify, acceptance criteria, and dependencies on other tasks.

**How to use this document:**

1. Pick the next unblocked task (all dependencies marked `[x]`)
2. Spawn an agent with the task description + acceptance criteria
3. Agent delivers a PR
4. You review, merge, move to next task

**Task sizing:** Each task is 1-4 hours of agent work. Some are smaller (type definitions, config changes). None should take more than a session.

**Branch strategy:** Each task gets its own branch: `feature/<task-id>-<slug>` (e.g. `feature/1.01-soft-delete`)

**Build verification:** Every task MUST pass `pnpm -r build && pnpm vitest run` before the PR is opened.

**Plugin checklist:** Any task that adds a new plugin MUST follow the plugin checklist in CLAUDE.md (package.json, pnpm-workspace.yaml, Dockerfile COPY lines, tsconfig paths, daemon registration).

---

## Phase 1: Data Safety & Foundation

Core data safety features and foundational infrastructure that other phases depend on.

### 1.01 — Soft Delete / Trash

**Description:** Replace permanent `delete_note` with a soft-delete mechanism. Deleted notes move to a "trash" state and are recoverable for 30 days. A background job permanently purges expired trash. This is a foundational safety feature — nothing should be permanently lost without intent.

**Files to modify:**

- `packages/shared/src/types/` — Add `deleted` to `ContentStatus` union type (`saved | read | archived | deleted`). Add `deletedAt?: string` (ISO date) to note metadata interface.
- `packages/core/src/storage/sqlite.ts` — Update `deleteNote()` to set `status = 'deleted'` and `deletedAt = now` instead of removing the row. Add `purgeNote(id)` for permanent deletion. Update all list/search queries to exclude `status = 'deleted'` by default.
- `packages/core/src/storage/markdown.ts` — On soft delete, move the `.md` file from `knowledge/` to `knowledge/.trash/` (preserving the file for Obsidian users). On purge, remove the file from `.trash/`. On restore, move it back.
- `packages/core/src/storage/vectordb.ts` — On soft delete, keep vectors (they're cheap). On purge, remove vectors.
- `packages/core/src/agent/tools/delete-note.ts` — Update tool to soft-delete. Response message should say "moved to trash" not "permanently deleted". Add optional `permanent: boolean` parameter (default false) for explicit hard delete.
- `packages/core/src/agent/tools/index.ts` — Register the new `restore_note` tool.

**Files to create:**

- `packages/core/src/agent/tools/restore-note.ts` — New tool: `restore_note`. Takes `noteId: string`. Sets status back to `saved`, clears `deletedAt`, moves file out of `.trash/`. Fails if note isn't in trash.
- `packages/core/src/agent/tools/list-trash.ts` — New tool: `list_trash`. Lists all notes with `status = 'deleted'`. Shows title, original tags, deletedAt, days until permanent deletion.

**Background job:**

- `packages/scheduler/src/workers/trash-purge.ts` — New BullMQ processor for `trash_purge`. Runs daily (`0 3 * * *`). Finds all notes with `status = 'deleted'` and `deletedAt` older than 30 days. Calls `purgeNote()` for each. Logs count of purged notes.
- `packages/scheduler/src/workers/processor.ts` — Register the `trash_purge` processor in `createJobRouter`.
- `packages/scheduler/src/index.ts` — Register the `trash_purge` schedule via `ScheduleManager`.

**Acceptance criteria:**

- `delete_note` moves notes to trash (status=deleted, file to .trash/)
- `restore_note` recovers notes from trash
- `list_trash` shows trashed notes with time-to-purge
- All search/list queries exclude deleted notes by default
- Background job purges notes older than 30 days
- Markdown files are preserved in `.trash/` subdirectory (Obsidian can see them if desired)
- Existing tests for delete still pass (behavior changed but interface compatible)
- `pnpm -r build` passes

**Dependencies:** None

---

### 1.02 — Note Version History

**Description:** Track revision history for notes. Each time `update_note` is called, store the previous version as a snapshot. Users can view history and restore any previous version. Snapshots are stored in SQLite (not as separate files) to keep the filesystem clean.

**Files to create:**

- `packages/core/src/storage/revisions.ts` — Revision storage module:
  - `saveRevision(noteId: string, content: NoteContent, metadata: NoteMetadata): Promise<string>` — Stores a revision, returns revisionId
  - `getRevisions(noteId: string, limit?: number): Promise<Revision[]>` — List revisions for a note (newest first)
  - `getRevision(revisionId: string): Promise<Revision>` — Get specific revision content
  - `pruneRevisions(noteId: string, keepCount: number): Promise<number>` — Remove old revisions beyond keepCount
  - Schema: `revisions` table (id TEXT PK, noteId TEXT, title TEXT, content TEXT, tags TEXT, category TEXT, createdAt TEXT, INDEX on noteId+createdAt)
- `packages/core/src/agent/tools/note-history.ts` — New tool: `note_history`. Parameters: `noteId: string`, `limit?: number` (default 10). Returns list of revisions with timestamps, title at that point, and a brief diff summary.
- `packages/core/src/agent/tools/restore-version.ts` — New tool: `restore_version`. Parameters: `noteId: string`, `revisionId: string`. Saves current state as a new revision, then overwrites note with the target revision content.

**Files to modify:**

- `packages/core/src/storage/sqlite.ts` — Add `revisions` table creation to schema migration. Add `initRevisions()` call.
- `packages/core/src/agent/tools/update-note.ts` — Before applying update, call `saveRevision()` with the current state.
- `packages/core/src/agent/tools/index.ts` — Register `note_history` and `restore_version` tools.

**Acceptance criteria:**

- Every `update_note` call creates a revision snapshot automatically
- `note_history` lists past versions with timestamps
- `restore_version` replaces current content with a historical version (and saves the current as a new revision first)
- Revisions stored in SQLite, not as files
- Max 50 revisions per note (pruned automatically on save)
- `pnpm -r build` passes

**Dependencies:** None

---

### 1.03 — Automated Backups

**Description:** Add a scheduled backup job that creates compressed archives of all EchOS data (SQLite DB, vector DB, markdown files). Supports local and configurable retention. This is critical for a self-hosted system — users need data safety without manual effort.

**Files to create:**

- `packages/core/src/backup/index.ts` — Backup module:
  - `createBackup(config: BackupConfig): Promise<BackupResult>` — Creates a timestamped `.tar.gz` in the backup directory containing:
    - `knowledge/` directory (all markdown files)
    - `db/echos.db` (SQLite, using `.backup` API for consistency)
    - `db/vectors/` (LanceDB data)
    - `backup-manifest.json` (version, timestamp, note count, file list)
  - `listBackups(backupDir: string): Promise<BackupInfo[]>` — List existing backups with size and timestamp
  - `restoreBackup(backupPath: string, targetDir: string): Promise<void>` — Extract a backup to target directory (does NOT overwrite live data automatically — user must swap dirs)
  - `pruneBackups(backupDir: string, keepCount: number): Promise<number>` — Remove oldest backups beyond keepCount
- `packages/core/src/agent/tools/backup.ts` — New tool: `manage_backups`. Subcommands via a `action` parameter:
  - `create` — Trigger a manual backup now
  - `list` — Show existing backups with size and age
  - `prune` — Remove old backups beyond retention count
- `packages/scheduler/src/workers/backup.ts` — New BullMQ processor for `backup`. Configurable cron (default: `0 2 * * *` — 2 AM daily). Calls `createBackup()`, then `pruneBackups()`.

**Files to modify:**

- `packages/shared/src/config/` — Add `backup` config section: `{ enabled: boolean, cron: string, backupDir: string, retentionCount: number }` with defaults `{ enabled: true, cron: '0 2 * * *', backupDir: './data/backups', retentionCount: 7 }`
- `packages/scheduler/src/workers/processor.ts` — Register the `backup` processor in `createJobRouter`.
- `packages/scheduler/src/index.ts` — Register the `backup` schedule via `ScheduleManager`.
- `packages/core/src/agent/tools/index.ts` — Register `manage_backups` tool.

**Acceptance criteria:**

- Backup creates a valid `.tar.gz` with all data
- SQLite backup uses the `.backup()` API (not file copy) for consistency
- Manifest includes version, timestamp, note count
- Retention prunes oldest backups automatically
- Agent tool allows manual backup creation and listing
- Scheduled job runs at configured cron
- Restore extracts to a target directory (never overwrites live data directly)
- `pnpm -r build` passes

**Dependencies:** None

---

### 1.04 — Knowledge Stats Tool

**Description:** Add a comprehensive statistics tool that gives users an overview of their knowledge base. Goes beyond `reading_stats` (which only covers reading queue) to provide total counts, growth trends, tag frequency, category distribution, and storage usage.

**Files to create:**

- `packages/core/src/agent/tools/knowledge-stats.ts` — New tool: `knowledge_stats`. No required parameters. Returns:
  - **Totals:** note count by type (note, article, youtube, tweet, journal, image, conversation), total tags, total links
  - **Status breakdown:** saved/read/archived counts
  - **Growth:** notes created per week for last 8 weeks (sparkline-friendly data)
  - **Top tags:** top 20 tags by frequency
  - **Top categories:** top 10 categories by count
  - **Storage:** disk usage of knowledge dir, SQLite size, vector DB size
  - **Streaks:** current daily creation streak, longest streak
  - Agent formats this as a readable summary with sections

**Files to modify:**

- `packages/core/src/storage/sqlite.ts` — Add query methods:
  - `getContentTypeCounts(): Promise<Record<ContentType, number>>`
  - `getStatusCounts(): Promise<Record<ContentStatus, number>>`
  - `getWeeklyCreationCounts(weeks: number): Promise<{week: string, count: number}[]>`
  - `getTagFrequencies(limit: number): Promise<{tag: string, count: number}[]>`
  - `getCategoryFrequencies(limit: number): Promise<{category: string, count: number}[]>`
  - `getLinkCount(): Promise<number>`
- `packages/core/src/agent/tools/index.ts` — Register `knowledge_stats` tool.

**Acceptance criteria:**

- Returns comprehensive stats across all dimensions
- Weekly growth data covers last 8 weeks
- Tag and category frequencies are accurate
- Storage sizes reported in human-readable format (KB/MB/GB)
- Streak calculation is correct (consecutive days with at least 1 note created)
- Query performance acceptable (< 500ms on a 10k note database)
- `pnpm -r build` passes

**Dependencies:** None

---

## Phase 2: Content Capture Expansion

New plugins for capturing knowledge from additional sources.

### 2.01 — PDF Extraction Plugin

**Description:** Build a plugin that extracts text content from PDF files (papers, ebooks, reports). Supports URL download and direct file upload. Uses `pdf-parse` (pure JS, no native deps) for extraction. Auto-categorizes like other content plugins.

**Files to create:**

- `plugins/pdf/package.json` — Plugin package. Dependencies: `pdf-parse`.
- `plugins/pdf/src/index.ts` — Plugin entry. Exports `EchosPlugin` with `save_pdf` tool.
- `plugins/pdf/src/tool.ts` — `save_pdf` tool:
  - Parameters: `url?: string` (PDF URL), `title?: string`, `tags?: string[]`, `categorize?: boolean` (default true)
  - Flow: download PDF → extract text via pdf-parse → truncate to content size limit → create note with type `article` (or new type `pdf`) and `inputSource: 'file'`
  - Handle: password-protected PDFs (fail gracefully with message), oversized PDFs (truncate with notice), corrupt files
  - URL validation via `validateUrl()` from `@echos/shared`
- `plugins/pdf/tsconfig.json` — TypeScript config extending root.

**Files to modify:**

- `pnpm-workspace.yaml` — Add `plugins/pdf` if not glob-matched.
- `docker/Dockerfile` — Add `COPY plugins/pdf/package.json plugins/pdf/` in deps stage, and production stage copy.
- Root `tsconfig.json` — Add path alias for `@echos/plugin-pdf`.
- Daemon entry point — Register pdf plugin.

**Acceptance criteria:**

- Extracts readable text from standard PDFs
- Handles URLs (with SSRF validation) and file paths
- Truncates oversized content gracefully (with "[content truncated]" notice)
- Fails gracefully on password-protected or corrupt PDFs
- Auto-categorizes by default
- Note includes metadata: page count, source URL, extracted text length
- Plugin checklist fully completed (Dockerfile, workspace, tsconfig, registration)
- `pnpm -r build` passes

**Dependencies:** None

---

### 2.02 — Podcast/Audio Plugin

**Description:** Build a plugin that saves podcast episodes or audio files by transcribing them via Whisper. Accepts URLs to audio files or podcast episode pages. Reuses the existing Whisper integration from the Telegram voice handler.

**Files to create:**

- `plugins/audio/package.json` — Plugin package.
- `plugins/audio/src/index.ts` — Plugin entry. Exports `EchosPlugin` with `save_audio` tool.
- `plugins/audio/src/tool.ts` — `save_audio` tool:
  - Parameters: `url: string` (audio file URL or podcast page URL), `title?: string`, `tags?: string[]`, `categorize?: boolean`
  - Flow: download audio → transcribe via OpenAI Whisper API → create note with type `note` (or add `audio` to ContentType) and `inputSource: 'voice'`
  - Supports: .mp3, .wav, .m4a, .ogg, .webm, .mp4 (audio track)
  - Size limit: 25MB (Whisper API limit). For larger files, split into chunks and concatenate transcripts.
  - URL validation via `validateUrl()`
- `plugins/audio/src/chunker.ts` — Audio chunking utility. If file > 25MB, split into sequential chunks using basic byte-range downloads (no ffmpeg dependency — just split at byte boundaries and let Whisper handle partial audio gracefully). Each chunk transcribed separately, results concatenated.
- `plugins/audio/tsconfig.json`

**Files to modify:**

- `pnpm-workspace.yaml` — Add `plugins/audio` if not glob-matched.
- `docker/Dockerfile` — Add COPY lines for audio plugin.
- Root `tsconfig.json` — Add path alias.
- Daemon entry point — Register audio plugin.

**Acceptance criteria:**

- Transcribes audio files from URL
- Handles common audio formats
- Respects Whisper 25MB limit (chunks larger files)
- Creates searchable note with full transcript
- Includes metadata: duration estimate, source URL, format
- Auto-categorizes by default
- Graceful failure for unsupported formats or unreachable URLs
- `pnpm -r build` passes

**Dependencies:** None (but requires `OPENAI_API_KEY` at runtime for Whisper)

---

### 2.03 — Code Snippet Plugin

**Description:** Build a plugin for saving code snippets, GitHub gists, and GitHub issue/PR discussions as knowledge notes. Parses GitHub URLs to fetch content via the GitHub API (unauthenticated for public repos, optional token for private).

**Files to create:**

- `plugins/code/package.json` — Plugin package.
- `plugins/code/src/index.ts` — Plugin entry. Exports `EchosPlugin` with `save_code` tool.
- `plugins/code/src/tool.ts` — `save_code` tool:
  - Parameters: `content?: string` (raw code), `url?: string` (GitHub URL), `language?: string`, `title?: string`, `tags?: string[]`, `categorize?: boolean`
  - URL patterns handled:
    - `github.com/<owner>/<repo>/blob/<ref>/<path>` → fetch raw file content
    - `gist.github.com/<user>/<id>` → fetch gist files
    - `github.com/<owner>/<repo>/issues/<n>` → fetch issue body + comments as discussion
    - `github.com/<owner>/<repo>/pull/<n>` → fetch PR description + review comments
  - For raw code: wrap in fenced code block with language tag
  - Note type: `note` with tag `code-snippet` auto-added
- `plugins/code/src/github.ts` — GitHub API fetcher:
  - `fetchFile(owner, repo, path, ref): Promise<string>` — Raw file content
  - `fetchGist(id): Promise<GistContent>` — Gist files
  - `fetchIssue(owner, repo, number): Promise<IssueContent>` — Issue + comments
  - `fetchPR(owner, repo, number): Promise<PRContent>` — PR + review comments
  - Uses `fetch()` with optional `GITHUB_TOKEN` env var for auth
  - Rate limit handling: check `X-RateLimit-Remaining` header, warn if low
- `plugins/code/tsconfig.json`

**Files to modify:**

- Standard plugin checklist (Dockerfile, workspace, tsconfig, registration)

**Acceptance criteria:**

- Saves raw code snippets with language detection
- Fetches files from GitHub blob URLs
- Fetches and formats gist content (multi-file gists concatenated)
- Fetches GitHub issues with comments as a readable thread
- Fetches PR descriptions with review comments
- Works without `GITHUB_TOKEN` for public repos
- URL validation via `validateUrl()`
- `pnpm -r build` passes

**Dependencies:** None

---

### 2.04 — RSS Feed Ingestion Plugin

**Description:** Build a plugin that subscribes to RSS/Atom feeds and periodically saves new articles. Uses the scheduler for background polling. Feed URLs stored in SQLite. Each new entry is saved via the existing article plugin's extraction logic.

**Files to create:**

- `plugins/rss/package.json` — Plugin package. Dependencies: `rss-parser`.
- `plugins/rss/src/index.ts` — Plugin entry. Exports `EchosPlugin` with tools and a background job.
- `plugins/rss/src/tools.ts` — Tools:
  - `manage_feeds` — Parameters: `action: 'add' | 'list' | 'remove' | 'refresh'`, `url?: string`, `name?: string`, `tags?: string[]`
    - `add`: Validate URL, fetch feed title, store in DB
    - `list`: Show all subscribed feeds with last check time and entry count
    - `remove`: Delete feed subscription
    - `refresh`: Trigger immediate check of one or all feeds
- `plugins/rss/src/feed-store.ts` — SQLite table for feeds:
  - `feeds` table: id, url, name, tags (JSON), lastCheckedAt, lastEntryDate, createdAt
  - `feed_entries` table: id, feedId, guid, url, title, publishedAt, savedNoteId
  - CRUD operations for feeds and entry tracking
- `plugins/rss/src/poller.ts` — Feed polling logic:
  - `pollFeed(feed: Feed): Promise<NewEntry[]>` — Fetch feed, find entries newer than `lastEntryDate`
  - `processEntry(entry: FeedEntry, feed: Feed): Promise<void>` — Use article plugin's extraction to save as note. Tag with feed-specific tags + `rss`.
  - Deduplication by `guid` or URL in `feed_entries` table
- `plugins/rss/src/job.ts` — Background job `rss_poll`. Default cron: `0 */4 * * *` (every 4 hours). Polls all active feeds.
- `plugins/rss/tsconfig.json`

**Files to modify:**

- Standard plugin checklist
- `packages/scheduler/src/workers/processor.ts` — Register the `rss_poll` processor in `createJobRouter`
- `packages/scheduler/src/index.ts` — Register the `rss_poll` schedule via `ScheduleManager`

**Acceptance criteria:**

- Can add/list/remove RSS feed subscriptions
- Background job polls feeds and saves new articles
- Deduplication prevents saving the same entry twice
- New entries auto-categorized and tagged with feed-specific tags
- Feed validation on add (must be parseable RSS/Atom)
- Manual refresh triggers immediate poll
- `pnpm -r build` passes

**Dependencies:** 2.01 is recommended but not required (article plugin already exists for extraction)

---

### 2.05 — Bookmark Import Tool

**Description:** Build a tool that imports bookmarks from browser exports (Netscape HTML format — the universal export format for Chrome, Firefox, Safari, and Brave) and from Pocket/Instapaper CSV exports. Each bookmark becomes a note; optionally runs article extraction on each URL.

**Files to create:**

- `packages/core/src/import/bookmarks.ts` — Bookmark import module:
  - `importNetscapeBookmarks(htmlPath: string, opts: ImportOpts): Promise<ImportResult>` — Parse Netscape bookmark HTML format. Extract: title, URL, add_date, tags (from folder hierarchy). Create a note per bookmark.
  - `importPocketExport(csvPath: string, opts: ImportOpts): Promise<ImportResult>` — Parse Pocket CSV (title, url, tags, status). Create a note per entry.
  - `importInstapaperExport(csvPath: string, opts: ImportOpts): Promise<ImportResult>` — Parse Instapaper CSV (URL, title, folder, timestamp).
  - `ImportOpts`: `{ dryRun: boolean, extractContent: boolean, tags: string[], limit?: number }`
  - `ImportResult`: `{ imported: number, skipped: number, errors: {url: string, reason: string}[] }`
  - When `extractContent: true`, call article extraction for each URL (rate-limited, 1 req/sec)
  - Deduplication: skip if a note with the same `sourceUrl` already exists
- `packages/core/src/agent/tools/import-bookmarks.ts` — New tool: `import_bookmarks`. Parameters: `filePath: string`, `format: 'netscape' | 'pocket' | 'instapaper'`, `extractContent?: boolean`, `tags?: string[]`, `dryRun?: boolean`. Returns import summary.

**Files to modify:**

- `packages/core/src/agent/tools/index.ts` — Register `import_bookmarks` tool.

**Acceptance criteria:**

- Parses Netscape HTML bookmark format (the standard for all major browsers)
- Parses Pocket CSV export format
- Parses Instapaper CSV export format
- Folder hierarchy converted to tags (e.g. "Bookmarks Bar/Tech/AI" → tags: ["tech", "ai"])
- Dry-run mode shows what would be imported without writing
- Deduplication by sourceUrl
- Optional article extraction (rate-limited)
- `pnpm -r build` passes

**Dependencies:** None

---

## Phase 3: Knowledge Graph & Discovery

Features that help users discover connections and patterns in their knowledge.

### 3.01 — Knowledge Graph Visualization Export

**Description:** Add the ability to export the note link graph in standard formats (Mermaid, DOT/Graphviz, JSON) so users can visualize their knowledge graph. Also add a tool that describes the graph topology around a topic.

**Files to create:**

- `packages/core/src/graph/index.ts` — Graph module:
  - `buildGraph(store: SqliteStore): Promise<KnowledgeGraph>` — Load all notes and their links into an in-memory adjacency list. `KnowledgeGraph`: `{ nodes: GraphNode[], edges: GraphEdge[] }` where `GraphNode` has `id, title, type, tags, category` and `GraphEdge` has `source, target, label?`.
  - `getSubgraph(graph: KnowledgeGraph, centerNodeId: string, depth: number): KnowledgeGraph` — Extract a subgraph around a center node up to N hops.
  - `exportMermaid(graph: KnowledgeGraph): string` — Export as Mermaid graph syntax
  - `exportDot(graph: KnowledgeGraph): string` — Export as DOT (Graphviz) syntax
  - `exportJson(graph: KnowledgeGraph): string` — Export as JSON (nodes + edges, compatible with D3/vis.js)
  - `getTopology(graph: KnowledgeGraph): TopologyStats` — Cluster count, most-connected nodes, orphan nodes, bridge nodes

- `packages/core/src/agent/tools/explore-graph.ts` — New tool: `explore_graph`. Parameters:
  - `action: 'around' | 'export' | 'stats'`
  - `noteId?: string` (for 'around' — show connections around a note)
  - `topic?: string` (for 'around' — search for notes matching topic, then show their connections)
  - `depth?: number` (default 2)
  - `format?: 'mermaid' | 'dot' | 'json'` (for 'export')
  - `around`: Returns a natural language description of connected notes within N hops
  - `export`: Returns the graph in the specified format (or saves to file if large)
  - `stats`: Returns topology overview (clusters, hubs, orphans)

**Files to modify:**

- `packages/core/src/agent/tools/index.ts` — Register `explore_graph` tool.

**Acceptance criteria:**

- Builds accurate graph from note links in SQLite
- Subgraph extraction respects depth limit
- Mermaid output is valid Mermaid syntax (renders in any Mermaid viewer)
- DOT output is valid Graphviz syntax
- JSON output follows a standard node-link format
- `around` mode gives a readable summary of connections
- `stats` identifies clusters, hubs (most-connected), and orphan notes (no links)
- Performance: handles 10k notes in < 2 seconds
- `pnpm -r build` passes

**Dependencies:** None

---

### 3.02 — Auto-Linking Suggestions

**Description:** When a note is created or categorized, automatically suggest links to related notes based on semantic similarity. The agent can accept or reject suggestions. This makes the knowledge graph grow organically without manual effort.

**Files to create:**

- `packages/core/src/graph/auto-linker.ts` — Auto-linking module:
  - `suggestLinks(noteId: string, store: SqliteStore, vectorStore: VectorStore, limit?: number): Promise<LinkSuggestion[]>` — Find semantically similar notes (top N by vector similarity, excluding already-linked notes). Return as `LinkSuggestion[]`: `{ targetId, targetTitle, similarity, reason }`.
  - `reason` is a brief explanation derived from shared tags/category/topic overlap.
  - Similarity threshold: configurable, default 0.82 (high enough to avoid noise).
  - Exclude: notes by the same source URL (avoid self-links on split content), notes already linked.

- `packages/core/src/agent/tools/suggest-links.ts` — New tool: `suggest_links`. Parameters: `noteId: string`, `limit?: number` (default 5). Returns link suggestions with similarity scores. Agent can then use `link_notes` to accept any.

**Files to modify:**

- `packages/core/src/agent/tools/index.ts` — Register `suggest_links` tool.
- `packages/core/src/agent/tools/categorize-note.ts` — After categorization completes, automatically run `suggestLinks()` and include top 3 suggestions in the response (agent can mention them to the user).

**Acceptance criteria:**

- Finds semantically related notes using vector similarity
- Excludes already-linked notes and self-references
- Similarity threshold filters out low-quality suggestions
- Integrated into categorization flow (suggestions shown after categorize)
- Standalone tool for on-demand suggestions
- `pnpm -r build` passes

**Dependencies:** None (uses existing vector store)

---

### 3.03 — Find Similar Notes Tool

**Description:** A focused tool that takes a note ID and returns the most semantically similar notes. Different from `search_knowledge` in that it takes a note (not a query string) and compares its full embedding against all others.

**Files to create:**

- `packages/core/src/agent/tools/find-similar.ts` — New tool: `find_similar`. Parameters:
  - `noteId: string` — The reference note
  - `limit?: number` (default 5)
  - `excludeType?: ContentType[]` — Optionally exclude certain types (e.g. exclude reminders)
  - Flow: get the note's embedding vector → query vector store for nearest neighbors → exclude the note itself → return ranked results with similarity percentage and shared tags

**Files to modify:**

- `packages/core/src/storage/vectordb.ts` — Add `findByVector(vector: number[], limit: number, excludeIds: string[]): Promise<SimilarResult[]>` if not already available (may need to expose raw vector query).
- `packages/core/src/agent/tools/index.ts` — Register `find_similar` tool.

**Acceptance criteria:**

- Finds notes similar to a given note by embedding distance
- Excludes the reference note itself from results
- Returns similarity as percentage (0-100%)
- Highlights shared tags and categories in results
- Type filtering works
- `pnpm -r build` passes

**Dependencies:** None

---

### 3.04 — Saved Searches / Smart Folders

**Description:** Allow users to save search queries that can be re-executed on demand. Saved searches act like smart folders — they're not static collections but dynamic queries. Stored in SQLite.

**Files to create:**

- `packages/core/src/storage/saved-searches.ts` — Saved search storage:
  - `SavedSearch` type: `{ id, name, query, filters: { type?, tags?, category?, status?, dateFrom?, dateTo? }, mode: 'semantic' | 'keyword' | 'hybrid', createdAt, lastRunAt, resultCount? }`
  - CRUD: `saveSearch()`, `listSearches()`, `deleteSearch()`, `updateSearch()`
  - SQLite table: `saved_searches`

- `packages/core/src/agent/tools/saved-searches.ts` — New tool: `manage_saved_searches`. Parameters:
  - `action: 'save' | 'list' | 'run' | 'delete'`
  - `name?: string` (for save)
  - `query?: string` (for save)
  - `filters?: object` (for save)
  - `searchId?: string` (for run/delete)
  - `save`: Store the search definition
  - `list`: Show all saved searches with last run info
  - `run`: Execute a saved search and return results (delegates to `search_knowledge`)
  - `delete`: Remove a saved search

**Files to modify:**

- `packages/core/src/storage/sqlite.ts` — Add `saved_searches` table to schema migration.
- `packages/core/src/agent/tools/index.ts` — Register `manage_saved_searches` tool.

**Acceptance criteria:**

- Save search queries with name and filters
- List saved searches with metadata
- Run a saved search (executes the stored query through existing search infrastructure)
- Delete saved searches
- Searches support all existing filter dimensions (type, tags, category, status, date range)
- `pnpm -r build` passes

**Dependencies:** None

---

## Phase 4: Organization & Workflow

Tools for organizing knowledge and managing tasks more effectively.

### 4.01 — Note Pinning / Starring

**Description:** Allow users to pin or star important notes for quick access. Pinned notes are returned first in relevant list operations and have a dedicated listing tool.

**Files to modify:**

- `packages/shared/src/types/` — Add `pinned?: boolean` and `pinnedAt?: string` to note metadata.
- `packages/core/src/storage/sqlite.ts` — Add `pinned` and `pinnedAt` columns to notes table (migration). Update `listNotes()` to sort pinned notes first when no explicit sort is specified.
- `packages/core/src/storage/markdown.ts` — Include `pinned` and `pinnedAt` in YAML frontmatter.
- `packages/core/src/agent/tools/list-notes.ts` — Add `pinnedOnly?: boolean` filter parameter. When true, return only pinned notes.

**Files to create:**

- `packages/core/src/agent/tools/pin-note.ts` — New tool: `pin_note`. Parameters: `noteId: string`, `pinned: boolean` (toggle). Sets `pinned` flag and `pinnedAt` timestamp.

**Files to modify:**

- `packages/core/src/agent/tools/index.ts` — Register `pin_note` tool.

**Acceptance criteria:**

- Notes can be pinned and unpinned
- Pinned notes appear first in `list_notes` results
- `list_notes` supports `pinnedOnly` filter
- Pinned status persists in both SQLite and markdown frontmatter
- `pnpm -r build` passes

**Dependencies:** None

---

### 4.02 — Note Templates

**Description:** Allow users to define note templates (meeting notes, book review, project brief, etc.) that pre-populate structure when creating notes. Templates are stored as markdown files in a `templates/` subdirectory of the knowledge directory.

**Files to create:**

- `packages/core/src/templates/index.ts` — Template module:
  - `listTemplates(knowledgeDir: string): Promise<Template[]>` — Scan `<knowledgeDir>/templates/` for `.md` files. Parse frontmatter for template metadata (name, description, category, tags).
  - `getTemplate(knowledgeDir: string, name: string): Promise<string>` — Return template content with placeholders.
  - `applyTemplate(template: string, variables: Record<string, string>): string` — Replace `{{variable}}` placeholders.
  - `createDefaultTemplates(knowledgeDir: string): Promise<void>` — Scaffold built-in templates if none exist.
  - Built-in templates: `meeting-notes.md`, `book-review.md`, `project-brief.md`, `weekly-review.md`, `decision-log.md`

- `packages/core/src/agent/tools/use-template.ts` — New tool: `use_template`. Parameters:
  - `action: 'list' | 'use' | 'create'`
  - `templateName?: string` (for 'use')
  - `variables?: Record<string, string>` (for 'use' — fills placeholders)
  - `list`: Show available templates with descriptions
  - `use`: Apply a template, creating a new note pre-populated with structure
  - `create`: Save a new custom template from the user's description

**Files to modify:**

- `packages/core/src/agent/tools/index.ts` — Register `use_template` tool.

**Acceptance criteria:**

- Templates stored as markdown in `<knowledgeDir>/templates/`
- 5 built-in templates scaffolded on first use
- Templates support `{{placeholder}}` variables
- Agent can list, use, and create templates
- Using a template creates a real note (not a draft)
- Custom templates can be created by the user
- `pnpm -r build` passes

**Dependencies:** None

---

### 4.03 — Recurring Reminders

**Description:** Extend the reminder system to support recurring reminders (daily, weekly, monthly, custom cron). When a recurring reminder fires, it creates the next occurrence automatically instead of being marked complete.

**Files to modify:**

- `packages/shared/src/types/` — Add to reminder type: `recurrence?: { pattern: 'daily' | 'weekly' | 'monthly' | 'cron', cronExpression?: string, endDate?: string }`.
- `packages/core/src/storage/sqlite.ts` — Add `recurrence` column (JSON) to reminders table. Add `getRecurringReminders()` query.
- `packages/core/src/agent/tools/reminder.ts` — Add `recurrence` parameter. Validate cron expressions. Support natural language: "every day", "every Monday", "every month on the 1st".
- `packages/scheduler/src/workers/reminder.ts` — When a recurring reminder fires:
  1. Broadcast the reminder as usual
  2. Instead of marking complete, calculate the next occurrence date
  3. Update `dueDate` to next occurrence
  4. If `endDate` is set and next occurrence is past it, mark complete
- `packages/core/src/agent/tools/list-reminders.ts` — Show recurrence info in reminder listings.

**Acceptance criteria:**

- Reminders can be created with daily/weekly/monthly/cron recurrence
- Recurring reminders auto-reschedule after firing
- End date support (stop recurring after a date)
- Natural language recurrence parsing ("every Monday at 9am")
- List view shows recurrence pattern
- Can convert a recurring reminder to one-time (and vice versa)
- `pnpm -r build` passes

**Dependencies:** None

---

### 4.04 — Todo Enhancements (Due Dates + Priority)

**Description:** Enhance the todo system with due dates and priority levels. Todos currently lack scheduling. This aligns them with the reminder system while keeping them distinct (todos = action items, reminders = time-anchored notifications).

**Files to modify:**

- `packages/shared/src/types/` — Add to todo type: `dueDate?: string`, `priority?: 'low' | 'medium' | 'high'`.
- `packages/core/src/storage/sqlite.ts` — Add `dueDate` and `priority` columns to todos table. Update queries to support sorting by priority and due date.
- `packages/core/src/agent/tools/reminder.ts` — When creating a todo (not a reminder), accept optional `dueDate` and `priority` parameters.
- `packages/core/src/agent/tools/list-todos.ts` — Add filters: `priority?: string`, `overdue?: boolean`, `dueBefore?: string`. Default sort: overdue first, then by priority (high→low), then by due date (nearest first).
- `packages/scheduler/src/workers/reminder.ts` — Check for overdue todos. If a todo is overdue by > 24h and hasn't been notified, broadcast a reminder.

**Acceptance criteria:**

- Todos support optional due dates and priority (low/medium/high)
- Default sort puts overdue + high priority first
- Overdue todos trigger a notification (once, not repeatedly)
- `list_todos` supports filtering by priority and overdue status
- Agent naturally detects priority from user language ("urgent", "when you get a chance", etc.)
- `pnpm -r build` passes

**Dependencies:** None

---

### 4.05 — Collections / Notebooks

**Description:** Add a lightweight grouping mechanism for notes. Collections are named groups that notes can belong to (many-to-many). Different from tags in that collections imply a deliberate curation ("my thesis research", "Q4 planning") while tags are metadata. Stored as a join table in SQLite.

**Files to create:**

- `packages/core/src/storage/collections.ts` — Collection storage:
  - `Collection` type: `{ id, name, description?, noteCount, createdAt, updatedAt }`
  - SQLite tables: `collections` (id, name, description, createdAt, updatedAt) + `collection_notes` (collectionId, noteId, addedAt)
  - CRUD: `createCollection()`, `listCollections()`, `getCollection()`, `deleteCollection()`, `addToCollection()`, `removeFromCollection()`, `getCollectionNotes()`

- `packages/core/src/agent/tools/collections.ts` — New tool: `manage_collections`. Parameters:
  - `action: 'create' | 'list' | 'show' | 'add' | 'remove' | 'delete'`
  - `name?: string` (for create)
  - `description?: string` (for create)
  - `collectionId?: string` (for show/add/remove/delete)
  - `noteId?: string` (for add/remove)
  - `create`: Create a new collection
  - `list`: Show all collections with note counts
  - `show`: List notes in a collection
  - `add`: Add a note to a collection
  - `remove`: Remove a note from a collection
  - `delete`: Delete a collection (notes are NOT deleted, just unlinked)

**Files to modify:**

- `packages/core/src/storage/sqlite.ts` — Add collection tables to schema migration.
- `packages/core/src/agent/tools/index.ts` — Register `manage_collections` tool.

**Acceptance criteria:**

- Notes can belong to multiple collections
- Collections have name, description, and note count
- Adding/removing notes from collections doesn't affect the notes themselves
- Deleting a collection doesn't delete the notes
- Agent can create, list, show, and manage collections
- `pnpm -r build` passes

**Dependencies:** None

---

## Phase 5: AI & Agent Intelligence

Enhanced AI capabilities for deeper knowledge work.

### 5.01 — Multi-Note Synthesis Tool

**Description:** Add a tool that takes multiple notes (by IDs, tags, or search query) and synthesizes them into a new summary note. Useful for research briefs, topic summaries, and connecting disparate pieces of knowledge.

**Files to create:**

- `packages/core/src/agent/tools/synthesize.ts` — New tool: `synthesize_notes`. Parameters:
  - `noteIds?: string[]` — Specific notes to synthesize
  - `query?: string` — Search query to find notes to synthesize
  - `tags?: string[]` — Filter by tags
  - `title: string` — Title for the synthesis note
  - `format?: 'summary' | 'brief' | 'comparison' | 'timeline'` (default 'summary')
  - `maxNotes?: number` (default 10, max 20)
  - Flow:
    1. Resolve notes (by IDs, query, or tags)
    2. Truncate each note to a reasonable context window chunk
    3. Build a synthesis prompt with all note contents
    4. Call LLM to generate synthesis in the requested format
    5. Save as a new note with links to all source notes
    6. Auto-tag with `synthesis` + source tags
  - Formats:
    - `summary`: Unified summary of all notes
    - `brief`: Executive briefing with key points and conclusions
    - `comparison`: Compare and contrast perspectives across notes
    - `timeline`: Chronological narrative from dated notes

**Files to modify:**

- `packages/core/src/agent/tools/index.ts` — Register `synthesize_notes` tool.

**Acceptance criteria:**

- Synthesizes multiple notes into a coherent new note
- Four output formats (summary, brief, comparison, timeline)
- New note links back to all source notes
- Handles up to 20 source notes (truncates individual notes if needed to fit context)
- Source notes resolved by IDs, search query, or tags
- `pnpm -r build` passes

**Dependencies:** None

---

### 5.02 — Translation Tool

**Description:** Add a tool that translates note content to another language using the LLM. Preserves markdown formatting, frontmatter structure, and note metadata. Can create a translated copy or update in-place.

**Files to create:**

- `packages/core/src/agent/tools/translate.ts` — New tool: `translate_note`. Parameters:
  - `noteId: string`
  - `targetLanguage: string` (e.g. "Spanish", "Japanese", "pt-BR")
  - `mode: 'copy' | 'replace'` (default 'copy')
  - `copy` mode: Creates a new note with translated content, title suffixed with `[lang]`, tagged with language tag, linked to original
  - `replace` mode: Translates in-place (saves revision first via 1.02 if available)
  - Preserves: markdown formatting, code blocks (untranslated), links, frontmatter structure

**Files to modify:**

- `packages/core/src/agent/tools/index.ts` — Register `translate_note` tool.

**Acceptance criteria:**

- Translates note content to target language
- Preserves markdown structure and code blocks
- Copy mode creates a linked translated note
- Replace mode updates in-place
- Works for any language the LLM supports
- `pnpm -r build` passes

**Dependencies:** 1.02 (optional — for revision history on replace mode)

---

### 5.03 — Proactive Suggestions System

**Description:** Add a background intelligence layer that periodically analyzes the user's knowledge and generates proactive suggestions. Not a tool the user invokes — instead, the agent mentions relevant suggestions when the user interacts.

**Files to create:**

- `packages/core/src/intelligence/suggestions.ts` — Suggestion engine:
  - `SuggestionType`: `'synthesis' | 'link' | 'review' | 'gap' | 'stale'`
  - `generateSuggestions(store: SqliteStore, vectorStore: VectorStore): Promise<Suggestion[]>`:
    - `synthesis`: "You have 7 notes about TypeScript patterns — want me to create a synthesis?"
    - `link`: "These 3 notes seem related but aren't linked" (uses auto-linker)
    - `review`: "You saved 12 articles last week but only read 2"
    - `gap`: "You've been researching X but haven't saved anything about closely related Y"
    - `stale`: "5 notes haven't been updated in 6+ months — want to review?"
  - Suggestions stored in SQLite with `dismissedAt` for user dismissals
  - Max 3 active suggestions at a time (to avoid being annoying)

- `packages/core/src/agent/tools/suggestions.ts` — New tool: `get_suggestions`. Parameters:
  - `action: 'list' | 'dismiss' | 'act'`
  - `suggestionId?: string`
  - `list`: Show current suggestions
  - `dismiss`: Hide a suggestion (won't regenerate for 7 days)
  - `act`: Execute the suggested action (triggers the relevant tool)

- `packages/scheduler/src/workers/suggestions.ts` — New BullMQ processor for `generate_suggestions`. Runs daily (`0 8 * * *`). Regenerates suggestions, respecting dismissals.

**Files to modify:**

- `packages/core/src/agent/system-prompt.ts` — Add instruction: "If suggestions are available, mention the most relevant one naturally in conversation (don't force it)."
- `packages/scheduler/src/workers/processor.ts` — Register the `generate_suggestions` processor in `createJobRouter`.
- `packages/scheduler/src/index.ts` — Register the `generate_suggestions` schedule via `ScheduleManager`.
- `packages/core/src/agent/tools/index.ts` — Register `get_suggestions` tool.

**Acceptance criteria:**

- Generates 5 types of proactive suggestions
- Suggestions are non-intrusive (max 3 active, dismissible)
- Dismissed suggestions don't return for 7 days
- Agent mentions suggestions naturally during conversation
- "Act" executes the suggested action via existing tools
- Background job regenerates daily
- `pnpm -r build` passes

**Dependencies:** 3.02 (auto-linker for link suggestions)

---

## Phase 6: Interfaces & Integration

Improvements to existing interfaces and new integration points.

### 6.01 — Webhook Inbound API

**Description:** Add an inbound webhook endpoint to the Web API that allows external tools (Zapier, IFTTT, n8n, custom scripts) to create notes programmatically. Supports a simple JSON payload with authentication.

**Files to modify:**

- `packages/web/src/routes/` — Add webhook route:
  - `POST /api/webhook/note` — Create a note from external source
    - Body: `{ title: string, content: string, tags?: string[], category?: string, sourceUrl?: string, type?: ContentType }`
    - Auth: Bearer token (reuses `WEB_API_KEY`) OR a separate `WEBHOOK_SECRET` for webhook-specific auth
    - Returns: `{ id, title, status: 'created' }` or error
  - `POST /api/webhook/url` — Save a URL (auto-detect type: article, youtube, tweet)
    - Body: `{ url: string, tags?: string[], categorize?: boolean }`
    - Auth: Same as above
    - Dispatches to appropriate plugin based on URL pattern
    - Returns: `{ id, title, type, status: 'created' }` or error

**Files to create:**

- `packages/web/src/routes/webhook.ts` — Webhook route handlers with validation and rate limiting (separate from chat rate limit — 60 req/min for webhooks).

**Acceptance criteria:**

- POST /api/webhook/note creates a note with full metadata
- POST /api/webhook/url auto-detects content type and dispatches to correct plugin
- Authentication via Bearer token
- Rate limited (60 req/min per token)
- Input validation via Zod schemas
- URL validation via `validateUrl()` for the URL endpoint
- Returns structured JSON response with created note ID
- `pnpm -r build` passes

**Dependencies:** None

---

### 6.02 — Notification Preferences

**Description:** Add user-configurable notification preferences. Users should control which notifications they receive (digest, resurface, journal prompts, reminders, overdue todos) and when (quiet hours). Currently all background jobs broadcast unconditionally.

**Files to create:**

- `packages/core/src/notifications/preferences.ts` — Notification preferences module:
  - `NotificationPreferences` type: `{ quietHoursStart?: string, quietHoursEnd?: string, timezone?: string, channels: { digest: boolean, resurface: boolean, journal: boolean, reminders: boolean, overdueTodos: boolean, suggestions: boolean } }`
  - `getPreferences(store: SqliteStore): Promise<NotificationPreferences>`
  - `updatePreferences(store: SqliteStore, prefs: Partial<NotificationPreferences>): void`
  - `shouldNotify(prefs: NotificationPreferences, type: string): boolean` — Check if notification should be sent (respects quiet hours and channel toggles)
  - Stored in SQLite `user_preferences` table (single row — single-user system)

- `packages/core/src/agent/tools/notification-prefs.ts` — New tool: `manage_notifications`. Parameters:
  - `action: 'show' | 'update'`
  - `quietHoursStart?: string` (e.g. "22:00")
  - `quietHoursEnd?: string` (e.g. "08:00")
  - `timezone?: string`
  - `channel?: string` (notification type name)
  - `enabled?: boolean`

**Files to modify:**

- All broadcast points in scheduler jobs (reminder-check, digest, resurface, journal) — check `shouldNotify()` before broadcasting.
- `packages/core/src/agent/tools/index.ts` — Register `manage_notifications` tool.

**Acceptance criteria:**

- Users can enable/disable each notification channel
- Quiet hours suppress all notifications during configured window
- Timezone-aware quiet hours
- Preferences persist in SQLite
- All scheduler jobs respect preferences before broadcasting
- Agent tool for viewing and updating preferences
- `pnpm -r build` passes

**Dependencies:** None

---

### 6.03 — Conversation Search

**Description:** Make saved conversations searchable. Currently `save_conversation` creates notes of type `conversation`, but there's no dedicated way to search through past conversation history. Add a tool that searches conversations specifically and can retrieve context from past exchanges.

**Files to create:**

- `packages/core/src/agent/tools/search-conversations.ts` — New tool: `search_conversations`. Parameters:
  - `query: string` — Search query
  - `dateFrom?: string` — Start date filter
  - `dateTo?: string` — End date filter
  - `limit?: number` (default 5)
  - Searches only notes with `type = 'conversation'` using hybrid search
  - Returns: conversation summaries with dates, matching excerpts, and note IDs for full retrieval

**Files to modify:**

- `packages/core/src/agent/tools/index.ts` — Register `search_conversations` tool.
- `packages/core/src/agent/system-prompt.ts` — Add instruction: "When user asks 'did we discuss X?' or 'what did I say about Y last week?', use search_conversations tool."

**Acceptance criteria:**

- Searches only conversation-type notes
- Hybrid search (keyword + semantic) for best results
- Date range filtering
- Returns readable summaries with matched excerpts
- Agent uses it automatically when user references past conversations
- `pnpm -r build` passes

**Dependencies:** None

---

### 6.04 — Share Note via Link

**Description:** Add the ability to generate a temporary shareable link for a note. The link serves the note as a rendered HTML page via the Web API. Links expire after a configurable duration (default 24h). This is for occasional sharing — not a publishing platform.

**Files to create:**

- `packages/core/src/sharing/index.ts` — Share link module:
  - `createShareLink(noteId: string, expiresIn?: number): Promise<ShareLink>` — Generate a random token, store in SQLite with noteId and expiry. Returns `{ token, url, expiresAt }`.
  - `getSharedNote(token: string): Promise<NoteContent | null>` — Validate token, check expiry, return note content if valid.
  - `revokeShareLink(token: string): Promise<void>` — Immediately invalidate a share link.
  - `listShareLinks(noteId?: string): Promise<ShareLink[]>` — List active share links.
  - SQLite table: `share_links` (token TEXT PK, noteId TEXT, expiresAt TEXT, createdAt TEXT)
  - Tokens: 32 bytes, URL-safe base64

- `packages/core/src/agent/tools/share-note.ts` — New tool: `share_note`. Parameters:
  - `action: 'create' | 'list' | 'revoke'`
  - `noteId?: string` (for create)
  - `expiresIn?: number` (hours, default 24, max 168/7 days)
  - `token?: string` (for revoke)

- `packages/web/src/routes/share.ts` — Public route (no auth):
  - `GET /share/:token` — Render note as HTML (basic markdown rendering with sanitization). Returns 404 if token invalid/expired.

**Files to modify:**

- `packages/web/src/routes/index.ts` — Mount share routes (outside auth middleware).
- `packages/core/src/storage/sqlite.ts` — Add `share_links` table to schema migration.
- `packages/core/src/agent/tools/index.ts` — Register `share_note` tool.
- `packages/scheduler/src/workers/export-cleanup.ts` — Extend the existing export-cleanup processor to also purge expired share links from the `share_links` table.

**Acceptance criteria:**

- Generate shareable links with expiry
- Links serve a clean, readable HTML rendering of the note
- Expired links return 404
- Links can be revoked immediately
- HTML output is sanitized (no XSS from note content)
- No authentication required to view shared notes (by design — the token IS the auth)
- Token is cryptographically random (32 bytes)
- `pnpm -r build` passes

**Dependencies:** None (Web API must be enabled)

---

## Phase 7: Search & Intelligence Enhancements

### 7.01 — Tag Cloud & Taxonomy Analysis

**Description:** Add a tool that provides deep analysis of the user's tag and category taxonomy. Shows frequency distribution, identifies orphan tags (used once), suggests merges for similar tags, and detects over/under-categorization.

**Files to create:**

- `packages/core/src/agent/tools/taxonomy.ts` — New tool: `analyze_taxonomy`. Parameters:
  - `action: 'overview' | 'orphans' | 'suggest-merges' | 'duplicates'`
  - `overview`: Tag cloud data (tag → count), category distribution, total unique tags, avg tags per note
  - `orphans`: Tags used only once (candidates for removal or renaming)
  - `suggest-merges`: Find tags that are semantically similar or likely typos (e.g. "javascript" vs "js", "machine-learning" vs "ml"). Uses string similarity (Levenshtein) + embedding similarity for semantic matches.
  - `duplicates`: Find notes that might be duplicates (same sourceUrl, very similar titles, or >95% embedding similarity)

**Files to modify:**

- `packages/core/src/agent/tools/index.ts` — Register `analyze_taxonomy` tool.

**Acceptance criteria:**

- Overview gives full tag/category frequency distribution
- Orphan detection finds single-use tags
- Merge suggestions identify similar tags (both typos and semantic synonyms)
- Duplicate detection finds likely duplicate notes
- String similarity + vector similarity combined for best results
- `pnpm -r build` passes

**Dependencies:** None

---

### 7.02 — Activity Timeline Tool

**Description:** Add a tool that shows a chronological activity timeline — what the user saved, read, created, and modified over a time period. More detailed than `knowledge_stats` (which shows aggregates) — this shows the actual items.

**Files to create:**

- `packages/core/src/agent/tools/activity-timeline.ts` — New tool: `activity_timeline`. Parameters:
  - `period?: 'today' | 'yesterday' | 'this-week' | 'last-week' | 'this-month'` (default 'this-week')
  - `dateFrom?: string`
  - `dateTo?: string`
  - Returns a chronological list of activities:
    - Notes created (with type, title, tags)
    - Notes read/archived (status changes)
    - Notes updated (with what changed)
    - Reminders completed
    - Conversations saved
  - Grouped by day with counts per activity type
  - Summary line: "This week: 12 notes created, 5 articles read, 3 reminders completed"

**Files to modify:**

- `packages/core/src/storage/sqlite.ts` — Add `getActivityTimeline(dateFrom, dateTo)` query that unions across created/updated/status-changed events.
- `packages/core/src/agent/tools/index.ts` — Register `activity_timeline` tool.

**Acceptance criteria:**

- Shows chronological activity for any time period
- Groups by day
- Includes all activity types (create, read, update, complete)
- Summary counts per activity type
- Natural language period support ("this week", "yesterday")
- `pnpm -r build` passes

**Dependencies:** None

---

## Phase 8: Platform Polish

Final polish, quality-of-life improvements, and documentation.

### 8.01 — Telegram Rich Cards

**Description:** Enhance Telegram note display with inline keyboard buttons for common actions. Currently notes are displayed as plain text. Add formatted cards with action buttons for mark-read, archive, pin, delete, and open-link (for URL-sourced content).

**Files to modify:**

- `packages/telegram/src/handlers/` — When the agent returns a note in a tool result:
  - Format note as a structured message: title (bold), type badge, tags, category, first 200 chars of content, source URL if present
  - Attach inline keyboard with contextual actions:
    - For unread notes: [Mark Read] [Archive] [Pin]
    - For articles/youtube/tweets: [Mark Read] [Open Link] [Archive]
    - For all notes: [Delete] (soft delete per 1.01)
  - Handler for inline keyboard callbacks to execute the actions

- `packages/telegram/src/handlers/inline-keyboard.ts` — Update callback handler to support new button types (pin, open-link).

**Acceptance criteria:**

- Notes displayed as formatted cards with type badges
- Contextual action buttons based on note type and status
- Buttons execute actions without requiring another message to the agent
- Source URL shown and linkable for web content
- Cards don't exceed Telegram message length limits (4096 chars)
- `pnpm -r build` passes

**Dependencies:** 1.01 (soft delete), 4.01 (pinning)

---

### 8.02 — Web Chat UI

**Description:** Build a minimal but functional web chat interface for EchOS. Currently the web interface is API-only. Add a single-page chat UI using vanilla HTML/CSS/JS (no framework dependency — keeps it light and self-contained). Served by the existing Fastify server.

**Files to create:**

- `packages/web/src/public/index.html` — Single-page chat UI:
  - Clean, minimal design (dark theme)
  - Chat message list (user messages right-aligned, agent left-aligned)
  - Input bar with send button
  - Streaming response rendering (SSE from existing /api/chat endpoint)
  - Tool call indicators (collapsible sections showing tool name and result)
  - Markdown rendering (use a lightweight lib like `marked` via CDN)
  - Model switcher (fast/balanced/deep)
  - Reset button
  - Responsive (works on mobile)
- `packages/web/src/public/styles.css` — Minimal CSS
- `packages/web/src/public/app.js` — Client-side JS:
  - SSE connection to /api/chat
  - Message history management
  - Token-based auth (prompt for API key on first visit, store in localStorage)

**Files to modify:**

- `packages/web/src/server.ts` — Serve static files from `public/` directory. Add route: `GET /` → serve `index.html`.

**Acceptance criteria:**

- Accessible at `http://localhost:3000` when web interface is enabled
- Chat messages render with markdown formatting
- Streaming responses show incrementally
- Tool calls shown as collapsible sections
- API key authentication (stored in localStorage)
- Model switching works
- Reset clears conversation
- Mobile-responsive
- No build step required (vanilla HTML/CSS/JS)
- `pnpm -r build` passes

**Dependencies:** None

---

### 8.03 — Documentation Updates

**Description:** Update all documentation to reflect new features added in this implementation plan. This is a documentation-only task — no code changes.

**Files to modify:**

- `docs/tools.mdx` — Add all new tools: `restore_note`, `list_trash`, `note_history`, `restore_version`, `manage_backups`, `knowledge_stats`, `explore_graph`, `suggest_links`, `find_similar`, `manage_saved_searches`, `pin_note`, `use_template`, `synthesize_notes`, `translate_note`, `get_suggestions`, `manage_notifications`, `search_conversations`, `share_note`, `analyze_taxonomy`, `activity_timeline`, `manage_collections`, `import_bookmarks`, `manage_feeds`
- `docs/plugins.mdx` — Add new plugins: PDF, Audio, Code Snippet, RSS
- `docs/interfaces.mdx` — Document webhook API endpoints, web chat UI, notification preferences
- `docs/scheduler.mdx` — Add new jobs: trash_purge, backup, rss_poll, generate_suggestions
- `docs/architecture.mdx` — Update architecture diagram with new modules (graph, templates, sharing, collections, suggestions)
- `docs/security.mdx` — Document share link security model, webhook authentication
- `docs/knowledge-import.mdx` — Add bookmark import section (Netscape, Pocket, Instapaper)

**Acceptance criteria:**

- All new features documented with usage examples
- No broken links
- Consistent formatting with existing docs
- New plugins follow existing plugin documentation pattern
- `docs/mint.json` updated with any new navigation entries

**Dependencies:** All previous tasks

---

## Dependency Graph

```
Phase 1: Data Safety & Foundation (no dependencies, start here)
├── 1.01 Soft Delete ──────────────────────────────────┐
├── 1.02 Version History                                │
├── 1.03 Automated Backups                              │
└── 1.04 Knowledge Stats                               │
                                                        │
Phase 2: Content Capture (no dependencies)              │
├── 2.01 PDF Plugin                                     │
├── 2.02 Audio Plugin                                   │
├── 2.03 Code Snippet Plugin                            │
├── 2.04 RSS Feed Plugin                                │
└── 2.05 Bookmark Import                                │
                                                        │
Phase 3: Knowledge Graph (no dependencies)              │
├── 3.01 Graph Visualization                            │
├── 3.02 Auto-Linking ─────────────────────────────┐    │
├── 3.03 Find Similar                              │    │
└── 3.04 Saved Searches                            │    │
                                                   │    │
Phase 4: Organization (no dependencies)            │    │
├── 4.01 Pinning ──────────────────────────────────│────┤
├── 4.02 Templates                                 │    │
├── 4.03 Recurring Reminders                       │    │
├── 4.04 Todo Enhancements                         │    │
└── 4.05 Collections                               │    │
                                                   │    │
Phase 5: AI Intelligence                           │    │
├── 5.01 Multi-Note Synthesis                      │    │
├── 5.02 Translation ── (optional) 1.02            │    │
└── 5.03 Proactive Suggestions ── depends on 3.02 ─┘    │
                                                        │
Phase 6: Interfaces & Integration                       │
├── 6.01 Webhook API                                    │
├── 6.02 Notification Preferences                       │
├── 6.03 Conversation Search                            │
└── 6.04 Share Note via Link                            │
                                                        │
Phase 7: Search & Intelligence                          │
├── 7.01 Taxonomy Analysis                              │
└── 7.02 Activity Timeline                              │
                                                        │
Phase 8: Platform Polish                                │
├── 8.01 Telegram Rich Cards ── depends on 1.01, 4.01 ─┘
├── 8.02 Web Chat UI
└── 8.03 Documentation ── depends on all previous

Phase 9: Codebase Modularization (no dependencies, all independent)
├── 9.01 Modularize Daemon Entry Point
├── 9.02 Split SQLite Storage
├── 9.03 Split Telegram Bot
├── 9.04 Extract Agent Tool Factory
├── 9.05 Split Web Chat Routes
├── 9.06 Auto-Generated Plugin Config
└── 9.07 Dockerfile Plugin Auto-Copy ── depends on 9.06
```

**Parallelization:** Phases 1-4 are fully independent — all 18 tasks can be worked in parallel. Phase 5.03 depends on 3.02. Phase 8.01 depends on 1.01 and 4.01. Phase 8.03 depends on everything. Phase 9 tasks are all independent (except 9.07 depends on 9.06) and can be done at any time — they're pure refactors with no feature dependencies.

**Recommended execution order for a single agent:**
1. 1.01 → 1.02 → 1.03 → 1.04 (safety first)
2. 2.01 → 2.03 → 2.04 → 2.05 → 2.02 (capture, audio last due to Whisper dep)
3. 3.01 → 3.02 → 3.03 → 3.04 (graph)
4. 4.01 → 4.02 → 4.03 → 4.04 → 4.05 (organization)
5. 5.01 → 5.02 → 5.03 (intelligence)
6. 6.01 → 6.02 → 6.03 → 6.04 (interfaces)
7. 7.01 → 7.02 (search)
8. 8.01 → 8.02 → 8.03 (polish)
9. 9.01 → 9.02 → 9.03 → 9.04 → 9.05 → 9.06 → 9.07 (modularization)

**Note:** Phase 9 should ideally be done **before** other phases to reduce merge conflicts during their implementation. Running 9.01–9.05 first makes all subsequent feature work less conflict-prone.

---

## Phase 9: Codebase Modularization

Split monolithic files and automate plugin registration boilerplate to reduce merge conflicts when working on parallel features. Every task in this phase is a pure refactor — no new features, no API changes, no consumer changes. The public interfaces (`SqliteStorage`, `createEchosAgent`, `createTelegramAdapter`, `registerChatRoutes`, etc.) remain identical; only the internal file structure changes.

**Guiding principles:**
- Facade pattern: callers never know the file was split
- No new dependencies or packages
- Each task must pass `pnpm -r build && pnpm vitest run` with zero regressions
- Each task is independent unless explicitly noted — safe to parallelize

---

### 9.01 — Modularize Daemon Entry Point (`src/index.ts`)

**Description:** The daemon entry point (`src/index.ts`, ~460 lines) is the single most-conflicted file in the codebase. Every new plugin, interface, or scheduler job requires edits here. It currently contains: a Redis TCP check utility, storage initialization, plugin imports/registration, agent deps assembly, scheduler setup, interface adapter wiring, and graceful shutdown. Split it into focused modules so parallel features rarely touch the same file.

**Files to create:**

- `src/plugin-loader.ts` — Auto-discovers plugins at runtime. Reads the `plugins/` directory (using `readdirSync`), validates each dirname matches `/^[a-z0-9-]+$/`, then dynamically imports `@echos/plugin-<dirname>` via `import()`. Returns `EchosPlugin[]`. Logs a warning and continues if any single plugin fails to load. This eliminates the need for manual imports and `pluginRegistry.register()` calls — **new plugins are picked up automatically** just by existing in the `plugins/` directory.
- `src/redis-check.ts` — Extract `checkRedisConnection()` and the `RedisCheckResult` interface. Pure utility, zero coupling to the rest of the daemon. ~90 lines.
- `src/storage-init.ts` — Extract storage initialization into `initStorage(config, logger)`. Creates and returns `{ sqlite, markdown, vectorDb, search, generateEmbedding }`. Also runs `reconcileStorage()` and starts the file watcher. ~60 lines.
- `src/scheduler-setup.ts` — Extract all scheduler/queue/worker setup into `setupScheduler(...)`. Takes config, storage objects, plugin registry, notification service. Creates queue, processors, workers, schedule manager. Returns `{ queueService, worker, scheduleManager }`. ~80 lines.
- `src/shutdown.ts` — Extract graceful shutdown into `createShutdownHandler(resources)`. Takes all closeable resources, returns a function that shuts them down in order. ~30 lines.

**Files to modify:**

- `src/index.ts` — Slim down to a ~50-line orchestrator:
  1. `loadConfig()`
  2. `initStorage(config, logger)`
  3. `loadPlugins()` → register loop
  4. `pluginRegistry.setupAll(...)`
  5. Assemble `agentDeps`
  6. Create interface adapters (Telegram, Web) — these stay inline (2-3 lines each)
  7. `setupScheduler(...)`
  8. Start interfaces
  9. `createShutdownHandler(...)`
  - Remove all 11 plugin `import` statements
  - Remove all 11 `pluginRegistry.register()` calls (replaced by `loadPlugins()` loop)
  - Remove `checkRedisConnection()` function body (now imported)

**Acceptance criteria:**

- `pnpm -r build` passes
- Daemon starts and logs show all 11 plugins registered via auto-discovery
- Redis check still runs at startup, fatal-exits on failure
- Scheduler initializes correctly (schedules sync, worker processes jobs)
- Graceful shutdown works (SIGINT/SIGTERM close all resources in order)
- `src/index.ts` is under 80 lines
- No manual plugin imports remain — adding a new plugin only requires creating the `plugins/<name>/` directory (plus package.json, tsconfig, Dockerfile entries per the plugin checklist)
- Existing tests pass without changes

**Dependencies:** None

---

### 9.02 — Split SQLite Storage (`packages/core/src/storage/sqlite.ts`)

**Description:** The SQLite storage module (~1000 lines) is the largest source file in the codebase. It contains the full database interface: schema creation, migrations, prepared statements, note CRUD with FTS5 search, reminders, schedules, memory, tag management, and aggregation queries. Any two features that touch storage will conflict. Split it into domain-specific modules behind the existing `SqliteStorage` facade.

**Files to create:**

- `packages/core/src/storage/sqlite-schema.ts` — Schema creation DDL (tables, indexes, FTS5 virtual table), migration logic, and all prepared statement initialization. Exports `initSchema(db: Database.Database, logger: Logger): PreparedStatements` where `PreparedStatements` is a typed object holding all `db.prepare()` results. Other domain modules receive this object instead of calling `db.prepare()` themselves.
- `packages/core/src/storage/sqlite-notes.ts` — Note CRUD operations: `upsertNote`, `updateNoteStatus`, `deleteNote`, `purgeNote`, `restoreNote`, `listDeletedNotes`, `getNote`, `getNoteByFilePath`, `listNotes`, `searchFts`, and any note-specific helpers. Exports a factory: `createNoteOps(db, stmts, logger) => NoteOps`.
- `packages/core/src/storage/sqlite-reminders.ts` — Reminder and todo CRUD: `upsertReminder`, `getReminder`, `listReminders`, `listTodos`. Exports `createReminderOps(db, stmts, logger) => ReminderOps`.
- `packages/core/src/storage/sqlite-schedules.ts` — Schedule CRUD: `upsertSchedule`, `getSchedule`, `listSchedules`, `deleteSchedule`. Exports `createScheduleOps(db, stmts, logger) => ScheduleOps`.
- `packages/core/src/storage/sqlite-memory.ts` — Memory operations: `upsertMemory`, `getMemory`, `listAllMemories`, `listTopMemories`, `searchMemory`. Exports `createMemoryOps(db, stmts, logger) => MemoryOps`.
- `packages/core/src/storage/sqlite-stats.ts` — Aggregation and analytics queries: `getTopTagsWithCounts`, `renameTag`, `mergeTag`, `getContentTypeCounts`, `getStatusCounts`, `getWeeklyCreationCounts`, `getCategoryFrequencies`, `getLinkCount`, and any other statistical methods. Exports `createStatsOps(db, stmts, logger) => StatsOps`.

**Files to modify:**

- `packages/core/src/storage/sqlite.ts` — Becomes a thin facade (~80 lines). `createSqliteStorage()` calls `initSchema()`, then composes all domain factories into a single object that satisfies the existing `SqliteStorage` interface using object spread: `return { db, close, ...createNoteOps(...), ...createReminderOps(...), ... }`. The `SqliteStorage` interface definition stays in this file, unchanged.

**Acceptance criteria:**

- `SqliteStorage` interface is unchanged — no consumer file needs modification
- `createSqliteStorage()` return type is identical
- All existing SQLite tests pass without changes (`pnpm vitest run`)
- `pnpm -r build` passes
- Each new file is under 250 lines
- `sqlite.ts` (the facade) is under 100 lines
- Prepared statements are initialized once in `sqlite-schema.ts` and shared across all domain modules

**Dependencies:** None

---

### 9.03 — Split Telegram Bot (`packages/telegram/src/index.ts`)

**Description:** The Telegram adapter (~550 lines) contains all bot logic in a single file: command handlers (/start, /reset, /usage, /model, /followup, /version), callback query handler (inline keyboard button presses with 2-phase execution pattern), and message handlers (text, voice/audio with Whisper, photos). Split into focused handler modules so that adding a new command doesn't conflict with improving voice message handling.

**Files to create:**

- `packages/telegram/src/commands.ts` — All `bot.command()` handlers (/start, /reset, /usage, /model, /followup, /version). Exports `registerCommands(bot, deps): void` where `deps` contains `agentDeps`, `config`, `logger`, per-user sessions/agents, and any shared helpers. Each command handler is a named function for testability.
- `packages/telegram/src/callbacks.ts` — Callback query handler for inline keyboard button presses. Contains the 2-phase execution pattern (confirm → execute). Exports `registerCallbacks(bot, deps): void`.
- `packages/telegram/src/messages.ts` — Message handlers for text, voice/audio (Whisper transcription), and photo messages. Exports `registerMessageHandlers(bot, deps): void`.

**Files to modify:**

- `packages/telegram/src/index.ts` — Becomes adapter orchestrator (~100 lines). Creates the bot instance, defines the shared `deps` object, calls `registerCommands(bot, deps)`, `registerCallbacks(bot, deps)`, `registerMessageHandlers(bot, deps)`. Implements `InterfaceAdapter` (start/stop). All public exports (`createTelegramAdapter`, `TelegramAdapter`) remain unchanged.

**Acceptance criteria:**

- `createTelegramAdapter` signature and return type unchanged
- `pnpm -r build` passes
- `index.ts` is under 120 lines
- Commands, callbacks, and message handlers are in separate files
- Shared types/helpers (e.g. per-user session map, `runAgent()` helper) are defined in `index.ts` and passed via `deps`, or extracted to a `types.ts` if needed
- No circular imports

**Dependencies:** None

---

### 9.04 — Extract Agent Tool Factory (`packages/core/src/agent/index.ts`)

**Description:** The agent factory (~330 lines) imports 38 tool constructors and has a 140-line tool instantiation array inside `createEchosAgent()`. Any new core tool requires edits to the import block and the instantiation array — guaranteed conflict if two tools are added in parallel. Extract the tool array into a separate module, and move the `AgentDeps` interface to its own file since it's frequently imported from other packages.

**Files to create:**

- `packages/core/src/agent/create-agent-tools.ts` — Exports `createAgentTools(deps: AgentToolDeps): AgentTool[]`. Contains all 38 tool imports and the full instantiation array. The `AgentToolDeps` type is a subset of what each tool needs (storage, embeddings, config, logger, etc.). ~180 lines. Adding a new core tool means editing only this file — not the main agent factory.
- `packages/core/src/agent/types.ts` — Exports `AgentDeps` interface (~30 fields) and `AgentToolDeps` type. These are stable, widely-imported types that benefit from their own file.

**Files to modify:**

- `packages/core/src/agent/index.ts` — Remove tool imports and instantiation array. Import `createAgentTools` from `./create-agent-tools.js` and `AgentDeps` from `./types.js`. `createEchosAgent()` calls `const tools = createAgentTools(toolDeps)` then passes `tools` to the agent. Re-export `AgentDeps` for backward compatibility. ~120 lines.
- `packages/core/src/index.ts` — Update re-exports if `AgentDeps` path changed (should still re-export from `./agent/index.js`).

**Acceptance criteria:**

- `createEchosAgent()` behaves identically
- `AgentDeps` is importable from `@echos/core` as before (re-exported)
- `pnpm -r build` passes
- `index.ts` is under 130 lines
- All 38 tool imports are in `create-agent-tools.ts`, not in `index.ts`
- Adding a new tool only requires editing `create-agent-tools.ts` and `tools/index.ts` barrel

**Dependencies:** None

---

### 9.05 — Split Web Chat Routes (`packages/web/src/api/chat.ts`)

**Description:** The web chat API (~305 lines) contains all chat-related endpoints in a single file: the main streaming `/api/chat` handler, plus `/api/chat/model`, `/api/chat/steer`, `/api/chat/followup`, `/api/chat/reset`. It also embeds agent session management (a `Map<userId, Agent>`) and auth checks. Split session management into its own module and group secondary routes separately from the main streaming handler.

**Files to create:**

- `packages/web/src/api/sessions.ts` — Agent session management. Exports `createSessionManager(agentDeps, logger)` which returns an object with: `getOrCreateAgent(userId)`, `resetSession(userId)`, `isAllowed(userId, allowedSet)`, and the internal session `Map`. This decouples session lifecycle from route handling.
- `packages/web/src/api/chat-routes.ts` — Secondary chat endpoints: `/api/chat/model`, `/api/chat/steer`, `/api/chat/followup`, `/api/chat/reset`. Exports `registerChatRoutes(app, sessionManager, config, logger)`. Each route is a focused function. ~130 lines.

**Files to modify:**

- `packages/web/src/api/chat.ts` — Keeps only the main `POST /api/chat` streaming endpoint and the `registerChatApi()` entry point that wires everything. Imports `createSessionManager` from `./sessions.js` and `registerChatRoutes` from `./chat-routes.js`. ~120 lines.

**Acceptance criteria:**

- All web chat endpoints behave identically
- `pnpm -r build` passes
- `chat.ts` is under 140 lines
- Session management is testable in isolation
- Auth check (`isAllowed`) is defined once, not duplicated per route

**Dependencies:** None

---

### 9.06 — Auto-Generated Plugin Config (`tsconfig.json` paths + `package.json` deps)

**Description:** Every new plugin currently requires manual entries in three root config files: `tsconfig.json` (path alias), root `package.json` (workspace dependency), and `docker/Dockerfile` (COPY lines). These are the most common merge conflict sources when two plugins are developed in parallel. Create a codegen script that auto-generates these entries by scanning the `plugins/` and `packages/` directories, so conflicts can be resolved by re-running the script instead of manual merge resolution.

**Files to create:**

- `scripts/sync-plugin-config.ts` — Codegen script that:
  1. Scans `plugins/*/package.json` and `packages/*/package.json`, reads each `name` field
  2. Generates `tsconfig.paths.json` containing all `compilerOptions.paths` entries (both packages and plugins), alphabetically sorted
  3. Updates root `package.json` `dependencies` section: ensures every `@echos/plugin-*` and `@echos/*` workspace package has a `"workspace:*"` entry
  4. Prints a summary of what was added/removed
  5. Exit code 0 if files are already in sync, exit code 1 if changes were written (useful in CI)
- `tsconfig.paths.json` — Auto-generated file containing `{ "compilerOptions": { "paths": { ... } } }`. Committed to the repo so IDE tooling works without running the script. Can be trivially regenerated after merge conflicts.

**Files to modify:**

- `tsconfig.json` — Remove the `paths` block from `compilerOptions`. Add `"extends": "./tsconfig.paths.json"` so paths are inherited from the generated file. Keep all other compiler options as-is.
- `package.json` — Add script: `"sync-plugins": "tsx scripts/sync-plugin-config.ts"`. The `dependencies` section contents are now managed by the script (but still committed and editable by hand if needed).
- `.github/copilot-instructions.md` — Add note to plugin checklist: "Run `pnpm sync-plugins` after creating a new plugin directory"
- `CLAUDE.md` — Same note added to plugin checklist

**Acceptance criteria:**

- Running `pnpm sync-plugins` generates `tsconfig.paths.json` that matches the current `tsconfig.json` paths exactly
- Running `pnpm sync-plugins` ensures root `package.json` has all workspace deps
- `pnpm -r build` passes after the migration (paths now come from `tsconfig.paths.json`)
- Simulated merge conflict resolution: after a conflict in `tsconfig.paths.json`, re-run `pnpm sync-plugins` → file is regenerated correctly
- Script is idempotent — running it twice produces no diff
- `tsconfig.json` no longer contains any `paths` entries

**Dependencies:** None

---

### 9.07 — Dockerfile Plugin Auto-Copy

**Description:** The Dockerfile has 22 per-plugin `COPY` lines across two stages (`deps` and `production`). Every new plugin adds two tightly-packed lines in both stages — guaranteed merge conflicts when two plugins are added in parallel. Refactor to use a shell-based approach that auto-discovers plugins, so the Dockerfile doesn't need per-plugin edits.

**Files to modify:**

- `docker/Dockerfile` — In the `deps` stage: replace the 11 individual `COPY plugins/<name>/package.json plugins/<name>/` lines with a two-step approach:
  1. `COPY plugins/ /tmp/all-plugins/` — Copy the entire plugins directory (this layer changes whenever any plugin source changes, but that's acceptable since the next `pnpm install` layer is also invalidated by lockfile changes)
  2. `RUN` a shell one-liner that extracts only `package.json` files: `for d in /tmp/all-plugins/*/; do name=$(basename "$d"); mkdir -p "plugins/$name" && cp "$d/package.json" "plugins/$name/"; done && rm -rf /tmp/all-plugins`
  - In the `production` stage: replace the 11 individual `COPY --from=deps /app/plugins/<name>/package.json plugins/<name>/` lines with the same pattern using `--from=deps`. Keep the `packages/*` COPY lines as-is (there are only 6, they're stable).

**Acceptance criteria:**

- `docker build -f docker/Dockerfile .` succeeds from the repo root
- Container starts and all 11 plugins load correctly
- No per-plugin COPY lines remain in the Dockerfile (only `COPY plugins/` and the extraction `RUN`)
- `packages/*` COPY lines are unchanged (stable, not worth automating)
- Adding a new plugin no longer requires any Dockerfile edit

**Dependencies:** 9.06 (the Dockerfile should reflect the same "auto-discover plugins" philosophy; do this after the codegen script so both follow the same convention)
