# Architecture

## Data Flow

```
User Input (any interface)
    │
    ▼
┌─────────────────────────────┐
│  Interface Adapter           │
│  (Telegram / Web / TUI)      │
│  - Auth verification         │
│  - Message normalization     │
│  - Response streaming        │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Agent Core (pi-agent-core)  │
│  - System prompt + context   │
│  - LLM reasoning (pi-ai)    │
│  - Tool selection & calling  │
│  - Session persistence       │
└──────────┬──────────────────┘
           │
     ┌─────┼─────────┐
     ▼     ▼         ▼
┌───────┐ ┌────────┐ ┌──────────┐
│ Core  │ │ Plugin │ │ Scheduler│
│ Tools │ │ Tools  │ │ (BullMQ) │
└───┬───┘ └───┬────┘ └─────┬───┘
    │         │            │
    └─────────┴────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Storage Layer               │
│  - Markdown files (source    │
│    of truth, git-friendly)   │
│  - SQLite (metadata + FTS5)  │
│  - LanceDB (vector search)  │
└─────────────────────────────┘
```

## Package Dependencies

```
@echos/shared          ← no dependencies (types, config, security, logging, NotificationService)
@echos/core            ← shared (storage, agent, plugin system)
@echos/telegram        ← shared, core (grammY bot, notification service)
@echos/web             ← shared, core (Fastify server)
@echos/tui             ← shared, core (terminal UI)
@echos/scheduler       ← shared, core, plugin-article, plugin-youtube (BullMQ workers)
@echos/plugin-youtube  ← shared, core (YouTube transcript extraction)
@echos/plugin-article  ← shared, core (web article extraction)
```

## Scheduler & Notifications

The scheduler package (`@echos/scheduler`) runs background jobs via BullMQ + Redis. It is opt-in via `ENABLE_SCHEDULER=true` and requires a running Redis instance.

Notification delivery is decoupled via `NotificationService` (defined in `@echos/shared`). The Telegram package provides the concrete implementation; the scheduler receives it via dependency injection and never imports `@echos/telegram` directly. When Telegram is disabled, a log-only fallback is used.

Workers:
- **Digest**: Creates a throwaway AI agent to summarize recent notes and reminders, broadcasts the result
- **Reminder check**: Queries SQLite for overdue reminders and sends notifications
- **Content processing**: Processes article/YouTube URLs queued by the agent

See [SCHEDULER.md](SCHEDULER.md) for configuration and usage details.

## Plugin Architecture

Content processors live in `plugins/` as separate workspace packages. Each plugin:
- Implements the `EchosPlugin` interface from `@echos/core`
- Returns agent tools from its `setup(context)` method
- Receives a `PluginContext` with storage, embeddings, logger, and config
- Is registered via `PluginRegistry` in the application entry point

Core tools (create_note, search, get, list, update, delete, reminders, memory, linking, categorize_note, save_conversation, mark_content) remain in `@echos/core`.
Domain-specific processors (YouTube, article, etc.) are plugins.

Plugins can optionally use the AI categorization service from `@echos/core` to automatically extract category, tags, gist, summary, and key points from content. See [CATEGORIZATION.md](CATEGORIZATION.md) for details.

## Storage Architecture

**SQLite** (better-sqlite3): Structured metadata index, FTS5 full-text search, memory store, reminders. The memory table stores long-term personal facts with a confidence score (0–1) and kind (`fact`, `preference`, `person`, `project`, `expertise`). Notes also store a `content_hash` (SHA-256) used to detect changes and skip unnecessary re-embedding. The `status` column tracks content lifecycle (`saved`, `read`, `archived`) and `input_source` records how content was captured (`text`, `voice`, `url`, `file`).

**LanceDB** (embedded): Vector embeddings for semantic search. No server process needed.

**Markdown files**: Source of truth. YAML frontmatter with structured metadata. Directory layout: `knowledge/{type}/{category}/{date}-{slug}.md`.

### Storage Sync

EchOS keeps the three storage layers in sync automatically, even when markdown files are added or edited outside the application:

**Startup reconciliation** (`reconcileStorage` in `packages/core/src/storage/reconciler.ts`):
Runs once at boot. Scans all `.md` files in the knowledge directory and compares them against SQLite using the `content_hash` column:
- **New file** → full upsert to SQLite + generate embedding in LanceDB
- **Content changed** → update SQLite + re-embed (OpenAI called only when content hash differs)
- **File moved** (same hash, different path) → update file path in SQLite only, no re-embed
- **No change** → skipped entirely
- **SQLite record with no file on disk** → deleted from SQLite and LanceDB

**Live file watcher** (`createFileWatcher` in `packages/core/src/storage/watcher.ts`):
Uses `chokidar` to watch `knowledge/**/*.md` while the app is running. Events are debounced (500 ms) and `awaitWriteFinish` is enabled to handle atomic saves from editors (VS Code, Obsidian, etc.):
- `add` / `change` → parse, compare content hash, upsert if changed (re-embed only on content change)
- `unlink` → look up note by file path in SQLite, delete from SQLite + LanceDB

Both paths use the same content hash check, so the OpenAI embeddings API is only called when note body text actually changes — metadata-only edits (frontmatter, tags, title) do not trigger re-embedding.

## Search

Hybrid search combines three strategies via Reciprocal Rank Fusion (RRF):
1. **Keyword** (FTS5): BM25-ranked full-text search across title, content, tags
2. **Semantic** (LanceDB): Cosine similarity on OpenAI embeddings
3. **Hybrid**: RRF fusion of keyword + semantic results

## Memory System

Long-term memory (`remember_about_me` / `recall_knowledge` tools) uses a hybrid strategy to balance cost and recall:

- **At agent creation** (including after `/reset`): the top 15 memories ranked by `confidence DESC, updated DESC` are injected directly into the system prompt as "Known Facts About the User". This ensures core personal facts are always available without an explicit tool call.
- **On-demand retrieval**: if more than 15 memories exist, `recall_knowledge` searches the full memory table using word-tokenised LIKE queries. The system prompt notes additional memories are available so the agent knows to use the tool.

This means `/reset` only clears the conversation history — all stored memories persist in SQLite and are reloaded into the next session automatically.

## AI Categorization — Streaming with Progressive JSON

The categorization service (`packages/core/src/agent/categorization.ts`) uses `streamSimple` from `@mariozechner/pi-ai` instead of a blocking `fetch`. As the LLM streams its JSON response, `parseStreamingJson` parses each partial chunk — which never throws, always returning `{}` on incomplete input.

When new fields become fully formed in the partial JSON, an optional `onProgress` callback fires:
- `"Category: programming"` — as soon as `category` is resolved
- `"Tags: typescript, api"` — updated each time a new tag appears
- `"Gist: One sentence summary."` — once the gist looks complete (>20 chars, ends with punctuation) — full mode only

Both `categorizeLightweight` and `processFull` accept `onProgress?: (message: string) => void`. Callers that don't need progressive updates (e.g. the scheduler digest worker) pass no callback and get the same blocking behaviour as before.

## Context Overflow Detection

The agent uses a two-layer approach to context window management:

**Layer 1 — Proactive pruning** (`createContextWindow` in `context-manager.ts`):
Runs before every LLM call via `transformContext`. Estimates token usage and slides the message window back to the nearest user-turn boundary until the budget fits. This should prevent overflows under normal operation.

**Layer 2 — Reactive detection** (`isAgentMessageOverflow` in `context-manager.ts`):
If a provider rejects the request despite pruning (e.g. single oversized message, model switch, token estimation drift), the last assistant message is checked against `isContextOverflow` from `@mariozechner/pi-ai`, which matches provider-specific error patterns for Anthropic, OpenAI, Gemini, Groq, Mistral, OpenRouter, and others.

On overflow detection:
- **Telegram**: Replies with "Conversation history is too long. Use /reset to start a new session." instead of a raw provider error string.
- **Web API**: Returns HTTP 413 with a structured error body (`{ error: "Conversation history is too long. Please reset your session." }`).

The helper `isAgentMessageOverflow(message, contextWindow)` is exported from `@echos/core` for use in any interface adapter.

## Agent Session Caching

Each agent instance is assigned a `sessionId` at creation time, forwarded to LLM providers that support session-aware prompt caching:

| Interface | Session ID format |
|---|---|
| Telegram | `telegram-{userId}` |
| Web | `web-{userId}` |
| TUI | `tui-local` |

**Effect by provider:**
- **Anthropic**: Extends prompt cache TTL from the default 5 minutes to longer durations. Set `PI_CACHE_RETENTION=long` for 1-hour retention.
- **OpenAI**: Enables 24-hour in-memory cache reuse across calls.

No configuration required — caching is automatic when a `sessionId` is present.

## Security

- User authentication via Telegram user ID whitelist
- SSRF prevention on all URL fetching
- HTML sanitization via DOMPurify
- Rate limiting (token bucket per user)
- Structured audit logging
- Secret redaction in Pino logs
