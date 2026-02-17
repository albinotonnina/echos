# Personal Knowledge Agent - Project Plan

## Vision
A self-hosted, markdown-native personal knowledge system powered by AI agents. Accessible via Telegram, web UI, and terminal. Built for extensibility and open source collaboration.

## Goals
1. **Replace rigid command-based systems** with intelligent agent that understands natural language
2. **Markdown-first storage** - all data in readable, portable files
3. **Multi-interface access** - Telegram (mobile), Web (desktop), TUI (power users)
4. **Plugin architecture** - community can extend capabilities
5. **Privacy-focused** - self-hosted, local-first, optional cloud sync

## Core Features (MVP)

### Knowledge Management
- **Notes** - Quick thoughts, ideas, meeting notes
- **Journal** - Daily entries, reflections
- **Articles** - Save web content with metadata
- **YouTube transcripts** - Auto-fetch and save
- **Reminders/Todos** - Task management
- **Tags & Links** - Organize and connect notes

### Search & Retrieval
- Full-text search (SQLite FTS5)
- Semantic search (vector embeddings)
- Tag-based filtering
- Date range queries
- Smart context retrieval for agent

### Agent Capabilities
Uses pi-agent-core with custom tools:
- `create_note` - Create markdown files with frontmatter
- `search_knowledge` - Multi-modal search
- `save_article` - Fetch and save web content
- `save_youtube` - Download transcripts
- `add_reminder` - Task management
- `link_notes` - Create connections
- `summarize` - Generate summaries
- More tools via plugins...

## Technical Architecture

```
┌─────────────────────────────────────────────────┐
│                  Interfaces                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ Telegram │  │  Web UI  │  │   TUI    │      │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘      │
└───────┼─────────────┼─────────────┼─────────────┘
        │             │             │
        └─────────────┼─────────────┘
                      │
        ┌─────────────▼──────────────┐
        │      Agent Core             │
        │  (@mariozechner/pi-agent)  │
        │                             │
        │  ┌────────────────────┐    │
        │  │  LLM Provider      │    │
        │  │  (@mariozechner/   │    │
        │  │   pi-ai)           │    │
        │  └────────────────────┘    │
        │                             │
        │  ┌────────────────────┐    │
        │  │  Tool Registry     │    │
        │  │  - Core tools      │    │
        │  │  - Plugin tools    │    │
        │  └────────────────────┘    │
        └─────────────┬───────────────┘
                      │
        ┌─────────────▼───────────────┐
        │     Storage Layer           │
        │                             │
        │  ┌────────────────────┐    │
        │  │  Markdown Files    │    │
        │  │  ~/knowledge/      │    │
        │  │  - notes/          │    │
        │  │  - journal/        │    │
        │  │  - articles/       │    │
        │  │  - youtube/        │    │
        │  └────────────────────┘    │
        │                             │
        │  ┌────────────────────┐    │
        │  │  SQLite Index      │    │
        │  │  - Full-text       │    │
        │  │  - Metadata        │    │
        │  └────────────────────┘    │
        │                             │
        │  ┌────────────────────┐    │
        │  │  Vector DB         │    │
        │  │  - Embeddings      │    │
        │  │  - Semantic search │    │
        │  └────────────────────┘    │
        └─────────────────────────────┘
```

## File Structure

```
knowledge-agent/
├── packages/
│   ├── core/                 # Agent core + tools
│   │   ├── src/
│   │   │   ├── agent/       # Agent initialization
│   │   │   ├── tools/       # Tool definitions
│   │   │   ├── storage/     # Markdown + DB layer
│   │   │   ├── search/      # Search implementations
│   │   │   └── plugins/     # Plugin system
│   │   └── package.json
│   │
│   ├── telegram/            # Telegram bot
│   │   ├── src/
│   │   │   └── bot.ts
│   │   └── package.json
│   │
│   ├── web/                 # Web UI
│   │   ├── src/
│   │   │   ├── components/
│   │   │   └── app.tsx
│   │   └── package.json
│   │
│   └── tui/                 # Terminal UI
│       ├── src/
│       │   └── index.ts
│       └── package.json
│
├── plugins/                 # Example plugins
│   ├── obsidian-compat/    # Obsidian compatibility
│   ├── notion-import/      # Import from Notion
│   └── graph-view/         # Knowledge graph viz
│
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── PLUGINS.md
│   ├── DEPLOYMENT.md
│   └── API.md
│
└── examples/
    ├── basic-setup/
    └── custom-plugin/
```

## Development Phases

### Phase 1: Core Foundation (Week 1-2)
- [ ] Project setup + monorepo structure
- [ ] Core agent with pi-ai + pi-agent-core
- [ ] Markdown storage layer
- [ ] Basic tools: create_note, search_knowledge
- [ ] SQLite search index
- [ ] Telegram bot MVP

### Phase 2: Essential Features (Week 3-4)
- [ ] Article saving (readability extraction)
- [ ] YouTube transcript fetching
- [ ] Reminder/todo system
- [ ] Note linking
- [ ] Vector search for semantic queries
- [ ] Web UI MVP

### Phase 3: UX Polish (Week 5-6)
- [ ] TUI interface
- [ ] Streaming responses in all interfaces
- [ ] Better markdown formatting
- [ ] Tag management
- [ ] Search refinement

### Phase 4: Extensibility (Week 7-8)
- [ ] Plugin API finalization
- [ ] Example plugins
- [ ] Plugin documentation
- [ ] Docker deployment polish
- [ ] CI/CD setup

### Phase 5: Open Source Launch
- [ ] Documentation complete
- [ ] Contributing guidelines
- [ ] Security audit
- [ ] Public GitHub repo
- [ ] Demo video
- [ ] HackerNews/Reddit launch post

## Migration from Existing System

### What to port:
1. **Docker setup** - Adapt existing Dockerfile + compose
2. **Oracle Cloud deployment** - Keep infrastructure, update app
3. **Telegram bot structure** - Reuse authentication, webhook setup
4. **Any existing markdown parsing** - Port if useful

### What to replace:
1. Intent classifier → Agent reasoning
2. Command handlers → Tool definitions
3. Rigid workflows → Agent-driven orchestration

### Migration strategy:
1. Run both systems in parallel initially
2. Port one feature at a time
3. Compare results / user experience
4. Gradually deprecate old system

## Success Metrics

### Technical
- Response time < 2s for simple queries
- Search accuracy > 90%
- Zero data loss (markdown integrity)
- Plugin API stable

### Community (if open source)
- 100+ GitHub stars in first month
- 5+ community plugins in first quarter
- Active Discord/discussions
- 10+ contributors

## Open Source Strategy

### Differentiation
- **vs Obsidian**: More AI-native, telegram-first
- **vs Notion**: Self-hosted, markdown, privacy
- **vs Logseq**: Better mobile UX via Telegram
- **vs DEVONthink**: Open source, extensible, cross-platform

### Community Building
1. Clear, detailed documentation
2. Video tutorials
3. Active Discord community
4. "Plugin of the week" highlights
5. Responsive to issues/PRs
6. Regular release cadence

### Monetization (optional future)
- Hosted version (like Supabase model)
- Premium plugins marketplace
- Enterprise support
- Keep core MIT licensed

## Next Steps for Claude Code

1. **Review ARCHITECTURE.md** - Understand technical decisions
2. **Check example-tools.ts** - See tool implementation patterns
3. **Set up project structure** - Create monorepo skeleton
4. **Implement core agent** - Get basic Q&A working
5. **Add first tools** - create_note, search_knowledge
6. **Test with Telegram** - Get end-to-end flow working

## Questions to Consider

- **LLM provider**: Start with Anthropic? Support multiple?
- **Deployment**: Docker-first? Support Railway/Fly.io?
- **Auth**: Single-user or multi-tenant?
- **Sync**: Local-only or optional cloud backup?
- **Mobile**: Just Telegram or native app later?

## Resources

- pi-mono repo: https://github.com/badlogic/pi-mono
- pi-ai docs: https://github.com/badlogic/pi-mono/tree/main/packages/ai
- pi-agent-core: https://github.com/badlogic/pi-mono/tree/main/packages/agent
- Claude Code: https://claude.ai/download
