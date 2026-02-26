<div align="center">

# 🔮 EchOS

**Your personal AI knowledge system — self-hosted, agent-driven, and always private.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript)](https://www.typescriptlang.org)
[![Claude](https://img.shields.io/badge/powered%20by-Claude%20AI-orange)](https://anthropic.com)

**[→ Full documentation at docs.echos.sh](https://docs.echos.sh)**

</div>

---

<div align="center">

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/P5P71PDYLX)

</div>

> [!NOTE]
> EchOS is a personal project — built for one user, deployed on your own infrastructure. It is intentionally not multi-tenant.

<div align="center">

<img src="assets/telegram-demo.png" alt="EchOS Telegram conversation" width="400">
<img src="assets/telegram-demo-2.png" alt="EchOS Telegram conversation" width="400">

*Save articles, search your knowledge, get reminders — all through natural conversation.*

</div>

<div align="center">

[![demo on YouTube](https://img.youtube.com/vi/D3QCQXqNewU/0.jpg)](https://www.youtube.com/watch?v=D3QCQXqNewU)

</div>

---

## What it feels like

You're walking and a thought hits. You open Telegram and say it out loud. Thirty seconds later it's in your knowledge base — transcribed, categorized, tagged, searchable. You didn't open an app. You didn't fill a form. You didn't think about where to put it.

That's the thing EchOS is trying to solve. Not the storage. The friction.

```
You:    Save this for me → [pastes article URL]
EchOS:  Saved. "How Rust handles memory safety" — tagged as rust, programming.
        I pulled the key points if you want a summary.

You:    What do I know about memory management?
EchOS:  Found 7 notes. The Rust piece you just saved, two older ones on GC pauses,
        a voice note from last Tuesday where you were ranting about malloc...

You:    Write a short post about it — my style, technical but readable
EchOS:  [drafts a post grounded in your actual notes, in your voice]

You:    Save it.
EchOS:  Done. You can open it in Obsidian whenever you want.
```

No commands to memorize. No schemas to design. No dashboards to maintain.

---

## Why self-hosted

Your notes are yours. They live on your server, in plain Markdown files you can open in Obsidian right now. No subscription. No sync fees. No vendor deciding what to do with your thinking.

The only outbound calls are to the AI APIs you configure — and only when you ask it to do something.

---

## The main things it does

**Capture without friction.** Text, URLs, voice messages, photos — through Telegram, the terminal, or the web. It figures out what to do with them.

**Search that actually understands you.** Not keyword matching. Hybrid full-text and semantic search: ask it a question the way you'd ask a person, and it finds what you meant.

**Write in your voice.** Tell it to write a blog post, a thread, an email. It reads your notes for source material and matches the way you actually write — not generic AI prose.

**Obsidian-compatible, always.** Every note is a plain `.md` file. Open `data/knowledge/` in Obsidian and your entire knowledge base is right there. Live sync, bidirectional.

**Remembers how you want it to talk.** Tell it to be concise, warmer, more technical. It adapts immediately and stays that way.

---

## Get started

```bash
# Local
git clone https://github.com/albinotonnina/echos.git && cd echos
pnpm install && pnpm wizard && pnpm build && pnpm start

# VPS (one-liner)
curl -sSL https://raw.githubusercontent.com/albinotonnina/echos/main/install.sh | bash
```

You'll need an LLM API key — either Anthropic (`ANTHROPIC_API_KEY`, pay-as-you-go, not a Claude subscription) or any other provider supported by pi-ai (`LLM_API_KEY`). Custom OpenAI-compatible endpoints (DeepInfra, local Ollama, etc.) are supported via `LLM_BASE_URL`. Everything else is optional.

**[→ Full setup guide at docs.echos.sh/SETUP_FIXES](https://docs.echos.sh/SETUP_FIXES)**

---

## Documentation

Everything you need to go deeper is at **[docs.echos.sh](https://docs.echos.sh)**.

| | |
|---|---|
| [Architecture](https://docs.echos.sh/ARCHITECTURE) | How the pieces fit together |
| [Deployment](https://docs.echos.sh/DEPLOYMENT) | VPS, Docker, nginx, systemd |
| [Security](https://docs.echos.sh/SECURITY) | What EchOS does and doesn't do with your data |
| [Knowledge Import](https://docs.echos.sh/KNOWLEDGE_IMPORT) | Bring in your Obsidian vault or Notion export |
| [Writing](https://docs.echos.sh/WRITING) | Voice profiles and content generation |
| [Plugins](https://docs.echos.sh/PLUGINS) | YouTube, articles, and building your own |
| [Troubleshooting](https://docs.echos.sh/TROUBLESHOOTING) | When things go sideways |

---

## License

MIT
