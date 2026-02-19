<div align="center">

# 🔮 EchOS

**Your personal AI knowledge system — self-hosted, agent-driven, and always private.**

*Talk to it on Telegram. Use it in your terminal. Access it from anywhere. Your data never leaves your server.*

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript)](https://www.typescriptlang.org)
[![Claude](https://img.shields.io/badge/powered%20by-Claude%20AI-orange)](https://anthropic.com)

</div>

---

> [!NOTE]
> EchOS is a personal project — built for one user, deployed on your own infrastructure. It is intentionally not multi-tenant.

<div align="center">

<img src="assets/telegram-demo.png" alt="EchOS Telegram conversation" width="400">
<img src="assets/telegram-demo-2.png" alt="EchOS Telegram conversation" width="400">

*Save articles, search your knowledge, get reminders — all through natural conversation.*

</div>

---

## What is EchOS?

EchOS is a **self-hosted AI agent** that manages your knowledge base through natural conversation. Instead of learning a rigid command set, you just talk to it:

- *"Save this article for me"* → fetches, summarizes, categorizes, and indexes it
- *"What do I know about LLMs?"* → hybrid full-text + semantic search across everything
- *"Remind me to review that paper next Monday"* → persistent reminder with delivery via Telegram
- *"Summarize what I've been reading this week"* → AI-generated digest from your actual notes

No dashboards to maintain. No schemas to design. No commands to memorize.

---

## Why EchOS?

| The problem | EchOS's answer |
|---|---|
| Notion/Obsidian don't understand you | Natural language via Claude AI agent |
| Cloud tools store your data | Fully self-hosted — your server, your data |
| Chatbots forget everything | Persistent memory, hybrid search, markdown storage |
| Saving things is friction | Send a Telegram message or a URL — done |
| Your notes are siloed | Obsidian-compatible markdown, git-friendly |

---

## Features

### 🧠 Agent-driven, not command-driven

EchOS uses a real LLM agent with tool calling (Claude). There's no rigid routing — the agent reads your intent and picks the right tools. Ask the same question ten different ways, get the same result.

### 🔍 Hybrid search that actually works

Three-strategy search fused with Reciprocal Rank Fusion:

- **Full-text** — BM25-ranked FTS5 across titles, content, and tags
- **Semantic** — cosine similarity on OpenAI vector embeddings
- **Hybrid** — best of both, reranked

### 📱 Reach it from anywhere

- **Telegram bot** — message it from your phone like a chat, including voice messages (Whisper transcription)
- **Web UI + REST API** — stream responses over SSE from any client
- **Terminal UI** — live in your terminal, never leave the keyboard

### 🗃️ Markdown-first, Obsidian-compatible

Every note is a plain `.md` file with YAML frontmatter — the same format Obsidian uses natively.

- **Open in Obsidian today**: point Obsidian at `data/knowledge/` and browse your entire knowledge base
- **Live sync**: edits saved in Obsidian are picked up by EchOS's file watcher instantly — no restart needed
- **Drop files in**: add any EchOS-formatted `.md` file, run `pnpm reconcile`, and it's indexed
- **Import existing vault**: `pnpm import:obsidian --source ~/vault --dry-run` previews the conversion; remove `--dry-run` to apply
- **Import from Notion**: `pnpm import:notion --source ~/notion-export --dry-run`

See [docs/KNOWLEDGE_IMPORT.md](docs/KNOWLEDGE_IMPORT.md) for the full import guide, frontmatter reference, and step-by-step walkthroughs.

### 🔌 Plugin architecture

Content processors are plugins, not core code. Ships with:

- **YouTube plugin** — extract and summarize transcripts
- **Article plugin** — fetch, clean, and summarize any web article

Adding your own plugin is [straightforward](docs/PLUGINS.md).

### ⏰ Scheduled background jobs (optional)

Redis-backed scheduler via BullMQ:

- **Daily AI digest** — summary of recent notes and upcoming reminders
- **Reminder delivery** — overdue reminders pushed to Telegram
- Configurable cron expressions for everything

### 🔐 Security-first

- User whitelist (Telegram user ID allowlist)
- SSRF prevention on all URL fetching
- Rate limiting per user (token bucket)
- HTML sanitization, secret redaction in logs
- All API keys stored in `chmod 0600` `.env` only

---

## Installation

### Local — interactive wizard

```bash
git clone https://github.com/albinotonnina/echos.git && cd echos
pnpm install
pnpm wizard       # guided setup: API keys, interfaces, storage
pnpm build
pnpm start
```

### VPS — one-liner

```bash
curl -sSL https://raw.githubusercontent.com/albinotonnina/echos/main/install.sh | bash
```

Detects platform, installs prerequisites, clones repo, installs deps, and launches the wizard.

### Docker — production

```bash
git clone https://github.com/albinotonnina/echos.git && cd echos
pnpm wizard --non-interactive   # reads env vars, writes .env
cd docker && docker compose up -d
```

With nginx + Let's Encrypt:

```bash
sed "s/DOMAIN_NAME/yourdomain.com/g" docker/nginx.conf.template > docker/nginx.conf
docker compose --profile nginx up -d
```

> [!TIP]
> See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for systemd service setup, nginx SSL, and VPS deployment instructions.

---

## Requirements

| Requirement | Details |
|---|---|
| Node.js 20+ | Required |
| pnpm 9+ | Required |
| Anthropic API key | Required (Claude agent - pay-as-you-go API, not subscription) |
| OpenAI API key | Optional (embeddings + Whisper) |
| Redis | Optional (scheduler only) |
| Python 3 + `youtube-transcript-api` | Optional (YouTube plugin) |

> [!IMPORTANT]
> **Anthropic API Access**: EchOS requires an Anthropic API key (pay-as-you-go plan), NOT a Claude Pro/Max subscription. Subscription plans don't provide programmatic API access. See [docs/ANTHROPIC_SUBSCRIPTION_INVESTIGATION.md](docs/ANTHROPIC_SUBSCRIPTION_INVESTIGATION.md) for details.

---

## Interfaces

<details>
<summary><strong>Telegram Bot</strong></summary>

1. Create a bot via [@BotFather](https://t.me/BotFather) and copy the token
2. Run `pnpm wizard` — enter token + your Telegram user ID
3. `pnpm start` and message your bot

Supports: text messages, voice messages (transcribed via Whisper), URLs, streaming responses.

</details>

<details>
<summary><strong>Web UI / REST API</strong></summary>

Starts on port 3000 by default.

```bash
# Chat
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"userId": 123, "message": "What do I know about distributed systems?"}'

# Reset session
curl -X POST http://localhost:3000/api/chat/reset \
  -H "Content-Type: application/json" \
  -d '{"userId": 123}'
```

Responses stream over SSE. `GET /health` for healthcheck.

</details>

<details>
<summary><strong>Terminal UI</strong></summary>

```bash
pnpm start:tui-only
```

Inline streaming responses in your terminal. Type `exit` to quit.

</details>

---

## Updating

```bash
pnpm update-echos
```

Pulls latest, reinstalls deps if lockfile changed, rebuilds, and warns if the config schema changed.

---

## Architecture

```
User (Telegram / Web / TUI)
    ↓
Interface Adapter  — auth · normalize · stream
    ↓
Agent Core (Claude)  — reasoning · tool selection · session
    ↓
Tools: create_note · search · recall · remind · save_article · save_youtube · …
    ↓
Storage Layer
  ├── Markdown files  (source of truth, Obsidian-compatible)
  ├── SQLite + FTS5   (metadata, full-text search, memory, reminders)
  └── LanceDB         (vector embeddings, semantic search)
```

Storage stays in sync automatically — a startup reconciler and live file watcher handle files added or edited outside the app. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ · TypeScript strict · ESM |
| Agent | Claude AI (pi-agent-core) |
| Telegram | grammY |
| Vector DB | LanceDB (embedded, no server) |
| Metadata DB | SQLite · better-sqlite3 · FTS5 |
| Queue | BullMQ · Redis |
| Web | Fastify · SSE |
| Logging | Pino (structured, secret-redacted) |

---

## Documentation

| Doc | Contents |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Data flow, storage sync, search, memory system |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | VPS, Docker, nginx, systemd |
| [PLUGINS.md](docs/PLUGINS.md) | Building custom content processors |
| [INTERFACES.md](docs/INTERFACES.md) | Telegram, Web API, TUI reference |
| [SCHEDULER.md](docs/SCHEDULER.md) | Background jobs, digests, reminders |
| [SECURITY.md](docs/SECURITY.md) | Security model and threat mitigations |
| [KNOWLEDGE_IMPORT.md](docs/KNOWLEDGE_IMPORT.md) | Obsidian vault opening, Notion import, frontmatter reference |
| [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common issues and fixes |

---

## License

MIT
