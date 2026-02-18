# EchOS

Agent-driven personal knowledge management system. Capture, process, search, and create content through natural language interaction across Telegram, Web, and Terminal interfaces.

## Features

### Core

- LLM agent with tool calling — no rigid command routing
- Plugin architecture for content processors (YouTube, articles, etc.)
- Hybrid search: full-text (FTS5) + semantic (vector embeddings) + reranking
- Markdown-first storage with YAML frontmatter (Obsidian-compatible)
- Multi-interface: Telegram bot (default), Web API (default), Terminal UI (optional)

### Knowledge Management

- Save and summarize web articles (plugin), YouTube videos (plugin), notes, journal entries
- **AI-powered categorization**: Automatic category, tags, and summaries using Claude AI
  - Lightweight mode: Fast categorization with category + tags
  - Full mode: Comprehensive analysis with gist, summary, and key points
- Semantic search across your entire knowledge base
- Bidirectional note linking

### Memory & Style (Planned)

- Personal memory: facts, preferences, projects, expertise
- Writing style learning from your produced content
- Content creation in your voice

## Architecture

```
User (Telegram / Web / TUI)
    → Interface Adapter (auth, normalize, stream)
    → Agent Core (pi-agent-core + pi-ai)
    → Core Tools (create_note, search, ...) + Plugin Tools (save_article, save_youtube, ...)
    → Storage (Markdown + SQLite/FTS5 + LanceDB vectors)
```

Content processors (YouTube, article, etc.) are **plugins** in `plugins/`, not core code. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Quick Start

```bash
# Clone
git clone <repo-url> echos && cd echos

# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys and settings

# Build all workspace packages
pnpm build

# Start the application (loads .env automatically)
pnpm start
```

### Redis Setup (Optional)

Redis is **only required** if you want to enable background jobs and the scheduler (`ENABLE_SCHEDULER=true` in `.env`). For basic knowledge management features, you can skip this step.

```bash
# Check if Redis is running
pnpm redis:status

# Start Redis (auto-detects platform: brew/systemd/Docker)
pnpm redis:start

# Verify connection
pnpm redis:health

# Start EchOS with scheduler enabled
pnpm start:with-scheduler
```

**Redis Commands:**

- `pnpm redis:status` - Check Redis status and connection
- `pnpm redis:start` - Start Redis (prefers native, falls back to Docker)
- `pnpm redis:stop` - Stop Redis
- `pnpm redis:health` - Verify Redis connectivity

See [docs/SCHEDULER.md](docs/SCHEDULER.md) for details on background jobs, digests, and reminders.

```

## Accessing the Interfaces

### Telegram Bot (Default: Enabled)

1. Configure `TELEGRAM_BOT_TOKEN` in `.env`
2. Start with `pnpm start`
3. Message your bot on Telegram

### Web UI (Default: Enabled)

1. Ensure `ENABLE_WEB=true` in `.env`
2. Start with `pnpm start`
3. Access at **<http://localhost:3000>**

**API Endpoints:**

- `GET /health` - Health check
- `POST /api/chat` - Send message (JSON: `{"userId": 123, "message": "your text"}`)
- `POST /api/chat/reset` - Reset session (JSON: `{"userId": 123}`)

**Example:**

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"userId": 123, "message": "What notes do I have?"}'
```

### Terminal UI (Default: Disabled)

1. Set `ENABLE_TUI=true` in `.env`
2. Start with `pnpm start`
3. Type your questions in the terminal
4. Type `exit` or `quit` to close

**Quick start (TUI only):**

```bash
# Run only the terminal interface (no Telegram/Web)
pnpm start:tui-only
```

**Note**: TUI runs in the same terminal process, so you'll see streaming responses inline.

### Running Single Interfaces

```bash
# Run only Web API (port 3000)
pnpm start:web-only

# Run only Terminal UI
pnpm start:tui-only

# Run with scheduler enabled (requires Redis)
pnpm start:with-scheduler

# Run all enabled interfaces (default)
pnpm start
```

See [docs/INTERFACES.md](docs/INTERFACES.md) for detailed usage and examples.

### First-Time Setup Notes

- **Node.js 20+** is required (24+ recommended for native `.env` support)
- **Intel Macs**: The project uses LanceDB 0.22.3 for darwin-x64 compatibility (see `packages/core/package.json`)
- **Build required**: All workspace packages must be built before first run (`pnpm build`)
- **Path mappings**: The root `tsconfig.json` includes workspace path mappings for tsx to resolve `@echos/*` imports
- **Environment file**: The start script uses `--env-file=.env` flag for automatic loading (Node 20.6+)

### Telegram Bot Conflicts

If you get error `409: Conflict: terminated by other getUpdates request`:

**The issue**: Another instance is polling Telegram (only one allowed at a time).

**Quick fix**:

```bash
# 1. Check bot status
./scripts/check-telegram-bot.sh status

# 2. Clear webhook and pending updates
./scripts/check-telegram-bot.sh delete-webhook

# 3. Stop local processes
pkill -f "tsx.*index.ts"

# 4. Check Docker
docker ps | grep echos
docker compose down  # if running

# 5. Wait 60 seconds (for Telegram timeout)
sleep 60

# 6. Start
pnpm start
```

**Still failing?** Check remote deployments (Oracle Cloud, VPS, etc.) - you may have a production instance running.

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md#telegram-bot-conflicts) for detailed steps.

## Requirements

- Node.js 20+
- pnpm 9+
- Redis (optional, required only if `ENABLE_SCHEDULER=true`)
- Python 3 + `youtube-transcript-api` (required for YouTube plugin):
  ```bash
  pip3 install youtube-transcript-api
  ```

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) if you encounter setup issues.

## Documentation

- [CATEGORIZATION.md](docs/CATEGORIZATION.md) - AI-powered categorization guide
- [PLUGINS.md](docs/PLUGINS.md) - Creating custom plugins
- [INTERFACES.md](docs/INTERFACES.md) - Using Telegram, Web, and TUI
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - System architecture
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) - Production deployment
- [SECURITY.md](docs/SECURITY.md) - Security considerations
- [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) - Common issues and fixes

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 20+ / TypeScript (strict, ESM) |
| Agent | pi-mono (pi-agent-core + pi-ai) |
| Telegram | grammY |
| Vector DB | LanceDB (embedded) |
| Metadata | SQLite (better-sqlite3 + FTS5) |
| Queue | BullMQ + Redis |
| AI | Claude (reasoning) + OpenAI (embeddings, Whisper) |
| Web | Fastify + pi-web-ui |
| Logging | Pino |

## License

MIT
