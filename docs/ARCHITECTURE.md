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
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐ ┌─────────────┐
│  Tools  │ │  Scheduler  │
│ (sync)  │ │  (BullMQ)   │
└────┬────┘ └──────┬──────┘
     │             │
     ▼             ▼
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
@echos/shared    ← no dependencies (types, config, security, logging)
@echos/core      ← shared (storage, agent, tools, processors)
@echos/telegram  ← shared, core (grammY bot)
@echos/web       ← shared, core (Fastify server)
@echos/tui       ← shared, core (terminal UI)
@echos/scheduler ← shared, core (BullMQ workers)
```

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
