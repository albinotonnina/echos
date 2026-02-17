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

Core tools (create_note, search, get, list, update, delete, reminders, memory, linking, categorize_note) remain in `@echos/core`.
Domain-specific processors (YouTube, article, etc.) are plugins.

Plugins can optionally use the AI categorization service from `@echos/core` to automatically extract category, tags, gist, summary, and key points from content. See [CATEGORIZATION.md](CATEGORIZATION.md) for details.

## Storage Architecture

**SQLite** (better-sqlite3): Structured metadata index, FTS5 full-text search, memory store, reminders.

**LanceDB** (embedded): Vector embeddings for semantic search. No server process needed.

**Markdown files**: Source of truth. YAML frontmatter with structured metadata. Directory layout: `knowledge/{type}/{category}/{date}-{slug}.md`.

## Search

Hybrid search combines three strategies via Reciprocal Rank Fusion (RRF):
1. **Keyword** (FTS5): BM25-ranked full-text search across title, content, tags
2. **Semantic** (LanceDB): Cosine similarity on OpenAI embeddings
3. **Hybrid**: RRF fusion of keyword + semantic results

## Security

- User authentication via Telegram user ID whitelist
- SSRF prevention on all URL fetching
- HTML sanitization via DOMPurify
- Rate limiting (token bucket per user)
- Structured audit logging
- Secret redaction in Pino logs
