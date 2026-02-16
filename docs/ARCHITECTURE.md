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
@echos/shared          ← no dependencies (types, config, security, logging)
@echos/core            ← shared (storage, agent, plugin system)
@echos/telegram        ← shared, core (grammY bot)
@echos/web             ← shared, core (Fastify server)
@echos/tui             ← shared, core (terminal UI)
@echos/scheduler       ← shared, core, plugin-article, plugin-youtube (BullMQ workers)
@echos/plugin-youtube  ← shared, core (YouTube transcript extraction)
@echos/plugin-article  ← shared, core (web article extraction)
```

## Plugin Architecture

Content processors live in `plugins/` as separate workspace packages. Each plugin:
- Implements the `EchosPlugin` interface from `@echos/core`
- Returns agent tools from its `setup(context)` method
- Receives a `PluginContext` with storage, embeddings, logger, and config
- Is registered via `PluginRegistry` in the application entry point

Core tools (create_note, search, get, list, update, delete, reminders, memory, linking) remain in `@echos/core`.
Domain-specific processors (YouTube, article, etc.) are plugins.

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
