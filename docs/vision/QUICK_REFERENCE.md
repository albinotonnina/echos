# Quick Reference - Knowledge Agent

## One-Page Summary

### What We're Building
Personal knowledge agent with natural language interface, replacing command-based systems. Telegram-first, markdown-native, self-hosted.

### Core Stack
```
- Runtime: Node.js 20+ / TypeScript
- Agent: @mariozechner/pi-ai + pi-agent-core
- Storage: Markdown files + SQLite + LanceDB
- Interfaces: Telegram, Web (React), TUI
- Deploy: Docker on Oracle Cloud / any VPS
```

### Key Patterns

#### Tool Definition
```typescript
import { Type } from "@sinclair/typebox";

const myTool = {
  name: "tool_name",
  description: "What this tool does",
  parameters: Type.Object({
    param: Type.String({ description: "..." })
  }),
  async execute({ param }) {
    // Do work
    return { content: [{ type: "text", text: "Result" }] };
  }
};
```

#### Markdown Frontmatter
```yaml
---
id: uuid-v4
type: note|journal|article|youtube|reminder
title: string
created: ISO-8601
updated: ISO-8601
tags: [array]
links: [note-ids]
---
```

#### Agent Initialization
```typescript
import { createAgentSession } from '@mariozechner/pi-coding-agent';

const session = await createAgentSession({
  sessionManager: SessionManager.persistent('./sessions'),
  authStorage: new AuthStorage(),
  modelRegistry: new ModelRegistry(),
  tools: [createNoteTool, searchTool, saveArticleTool],
});

await session.prompt("Create a note about X");
```

#### Telegram Bot Pattern
```typescript
bot.on('message', async (msg) => {
  const session = await getOrCreateSession(msg.chat.id);
  
  await session.prompt(msg.text, {
    onChunk: (chunk) => updateTelegramMessage(msg.chat.id, chunk)
  });
});
```

### File Structure
```
packages/
  core/         # Agent + tools + storage
  telegram/     # Bot
  web/          # React UI
  tui/          # Terminal
data/
  knowledge/    # Markdown files
  sessions/     # Agent sessions
  db/           # SQLite + vectors
```

### Essential Tools (MVP)
1. `create_note` - Save notes with frontmatter
2. `search_knowledge` - Full-text + semantic search
3. `save_article` - Fetch & save web articles
4. `save_youtube` - Download transcripts
5. `add_reminder` - Task management

### Development Commands
```bash
# Setup
npm install
npm run build

# Test
npm test
npm run test:agent

# Run
npm run dev:telegram    # Telegram bot
npm run dev:web         # Web UI
npm run dev:tui         # Terminal

# Docker
docker-compose up --build
docker-compose logs -f agent
```

### Environment Variables
```bash
ANTHROPIC_API_KEY=sk-ant-xxx
TELEGRAM_BOT_TOKEN=xxx
KNOWLEDGE_DIR=./data/knowledge
DEFAULT_MODEL=claude-3-5-haiku-20241022
```

### Critical Design Decisions

**Why pi-mono?**
- Multi-provider LLM support
- Tool calling built-in
- Streaming responses
- Active development

**Why markdown?**
- Human-readable
- Git-friendly
- Future-proof
- No vendor lock-in

**Why SQLite?**
- Fast full-text search (FTS5)
- Zero config
- Single file
- Reliable

**Why Telegram-first?**
- Best mobile UX
- No app to build
- Voice messages work
- File sharing built-in

**Why NOT MCP?**
- Tools as simple functions simpler
- Can add MCP via plugin later
- Keeps core minimal

### Common Workflows

**Add new tool:**
1. Create tool definition in `packages/core/src/tools/`
2. Export from `packages/core/src/tools/index.ts`
3. Add to tool registry in agent init
4. Test with direct agent call
5. Test via Telegram

**Add new note type:**
1. Update Note interface type union
2. Add case to file path determination
3. Update search filters
4. Document in README

**Deploy update:**
```bash
git pull
docker-compose down
docker-compose up -d --build
```

### Debugging Checklist

**Agent not calling tools:**
- [ ] Tool registered in agent init?
- [ ] Tool schema valid (Type.Object)?
- [ ] Tool description clear?
- [ ] Try explicit prompt: "Use X tool to..."

**Search not finding notes:**
- [ ] SQLite index updated?
- [ ] Embeddings generated?
- [ ] Check file permissions
- [ ] Test direct SQLite query

**Telegram bot not responding:**
- [ ] Token valid? (getMe test)
- [ ] Webhook cleared? (use polling)
- [ ] Check logs: docker-compose logs -f
- [ ] Network accessible?

### Performance Targets
- Search: < 100ms keyword, < 500ms semantic
- Agent first token: < 1s
- Agent full response: < 5s
- Memory usage: < 512MB steady state

### Security Notes
- Never commit .env
- Whitelist Telegram users in production
- Use HTTPS for web UI
- Keep Docker images updated
- Rotate API keys periodically

### Plugin System (Future)
```typescript
export const MyPlugin: KnowledgePlugin = {
  name: "my-plugin",
  version: "1.0.0",
  tools: [/* custom tools */],
  onNoteCreated: async (note) => {/* hook */},
};
```

### Migration from Old System
1. Extract Docker config ✓
2. Extract Telegram setup ✓
3. Port any custom logic
4. Run in parallel
5. Compare results
6. Switch over

### Launch Checklist
- [ ] Core features work
- [ ] Documentation complete
- [ ] Docker tested
- [ ] Security reviewed
- [ ] Demo video
- [ ] GitHub public
- [ ] Launch post
- [ ] Community setup

### Resources
- pi-mono: github.com/badlogic/pi-mono
- Docs: See PROJECT_PLAN.md, ARCHITECTURE.md
- Examples: example-tools.ts
- Deployment: DOCKER_SETUP.md
- Claude Code: CLAUDE_CODE_HANDOFF.md

### Next Steps (Day 1)
1. Set up monorepo structure
2. Install dependencies
3. Implement minimal agent
4. Add create_note tool
5. Test: "Create a note about testing"
6. Celebrate! 🎉
