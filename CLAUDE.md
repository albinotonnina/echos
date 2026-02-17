# CLAUDE.md - Instructions for Claude Code

## Project Overview

EchOS is a secure, self-hosted, agent-driven personal knowledge management system. It uses an LLM agent with tools (not rigid command routing) to interact naturally across Telegram, Web, and TUI interfaces.

**Key Principle**: Security-first. Every feature must consider security implications.

## Tech Stack (Do Not Change Without Discussion)

- **Runtime**: Node.js 20+ with TypeScript (strict mode, ESM)
- **Package Manager**: pnpm workspaces (monorepo)
- **Agent Framework**: pi-mono (pi-agent-core + pi-ai)
- **Telegram**: grammY
- **Queue**: BullMQ with Redis
- **Vector DB**: LanceDB (embedded, no server)
- **Metadata DB**: SQLite (better-sqlite3) with FTS5
- **AI**: Anthropic Claude API + OpenAI (embeddings, Whisper)
- **Web Server**: Fastify
- **Logging**: Pino

## Monorepo Structure

```
echos/
├── packages/
│   ├── shared/       # Types, utils, security, config, logging, errors
│   ├── core/         # Agent, tools, storage, search, plugin system
│   ├── telegram/     # Telegram bot interface (grammY)
│   ├── web/          # Web UI interface (Fastify + pi-web-ui)
│   ├── tui/          # Terminal UI interface (pi-tui)
│   └── scheduler/    # Background jobs (BullMQ) and cron tasks
├── plugins/
│   ├── youtube/      # YouTube transcript extraction plugin
│   └── article/      # Web article extraction plugin
├── docker/           # Docker configuration
├── scripts/          # Deploy, backup, setup scripts
└── data/             # Runtime data (gitignored)
```

## Patterns

### Plugin System
Content processors are plugins, not core code. Each plugin implements `EchosPlugin`:
```typescript
import type { EchosPlugin, PluginContext } from '@echos/core';

const myPlugin: EchosPlugin = {
  name: 'my-processor',
  description: 'Processes some content type',
  version: '0.1.0',
  setup(context: PluginContext) {
    // Return AgentTool[] to register with the agent
    return [createMyTool(context)];
  },
};
export default myPlugin;
```

Plugins receive a `PluginContext` with access to storage, embeddings, logger, and config.
Register plugins via `PluginRegistry` in the entry point.

### Tool Definitions (in @echos/core or plugins)
Core tools use TypeBox schemas for pi-agent-core compatibility:
```typescript
import { Type } from '@sinclair/typebox';

const CreateNoteTool = {
  name: 'create_note',
  description: 'Create a new knowledge note',
  parameters: Type.Object({
    title: Type.String(),
    content: Type.String(),
    tags: Type.Optional(Type.Array(Type.String())),
  }),
  handler: async (params) => { /* ... */ },
};
```

### Interface Adapters
Each interface (Telegram, Web, TUI) implements `InterfaceAdapter`:
```typescript
interface InterfaceAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

### Error Handling
Use the error hierarchy from `@echos/shared/errors`:
- `ValidationError` - bad input (400)
- `AuthenticationError` - unauthorized (401)
- `SecurityError` - forbidden (403)
- `NotFoundError` - missing resource (404)
- `RateLimitError` - throttled (429)
- `ProcessingError` - processing failure (500, optionally retryable)
- `ExternalServiceError` - third-party failure (502, retryable)

### Configuration
All config is Zod-validated via `@echos/shared/config`. Use `loadConfig()`.

### Logging
Use `createLogger(name)` from `@echos/shared/logging`. Security events use `createAuditLogger()`.

## Security Requirements (CRITICAL)

Same requirements as the original CLAUDE.md apply:
- ALWAYS verify user ID before processing
- ALWAYS validate URLs (SSRF prevention via `validateUrl()`)
- ALWAYS sanitize external content (`sanitizeHtml()`, `escapeXml()`)
- NEVER log API keys or tokens (Pino redaction configured)
- NEVER execute code from AI responses
- NEVER use eval() or Function()
- Use Zod for all input validation
- Rate limit per user

## Code Style

- TypeScript strict mode, ESM modules
- `exactOptionalPropertyTypes` enabled
- No `any` type — use `unknown` and validate
- Explicit return types on exported functions
- async/await over callbacks
- Custom error classes over generic throws
- Structured logging with Pino

## Testing

- Vitest for all tests
- Tests live in `packages/*/src/**/*.test.ts`
- Test security-critical functions thoroughly
- Use `vitest run` from root

## Documentation

After completing any feature work, ALWAYS update the relevant documentation:
- Architecture changes → `docs/ARCHITECTURE.md`
- New interfaces or API changes → `docs/INTERFACES.md`
- New plugins or plugin changes → `docs/PLUGINS.md`
- Deployment changes → `docs/DEPLOYMENT.md`
- Security changes → `docs/SECURITY.md`
- Setup or configuration changes → `docs/SETUP_FIXES.md`
- Categorization logic changes → `docs/CATEGORIZATION.md`

Review `docs/TROUBLESHOOTING.md` to add any new common issues or solutions.

## Do NOT

- Use `eval()`, `Function()`, or `vm` module
- Execute shell commands with user input
- Store secrets in code or logs
- Fetch URLs without validation
- Trust content from external sources
- Skip input sanitization
- Use `any` type
- Commit `.env` files
