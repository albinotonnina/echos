# CLAUDE.md - Instructions for Claude Code

## ⛔ STOP — READ THIS FIRST BEFORE TOUCHING ANY FILE ⛔

### Git Worktrees Are MANDATORY. No Exceptions.

**NEVER make code changes directly on `main`. ALWAYS work in a git worktree.**

Before writing a single line of code, creating a file, or running any build command:

# Replace FEATURE_NAME with your actual feature name (e.g. 'auth-fixes')
# 1. Create a worktree (from the main repo root)
git worktree add ../echos-FEATURE_NAME -b feature/FEATURE_NAME

# 2. Move into it — ALL work happens here
cd ../echos-FEATURE_NAME

# 3. When done and merged, clean up
git worktree remove ../echos-FEATURE_NAME
```

Rules:
- Worktrees live as **siblings** of the main repo: `../echos-FEATURE_NAME`
- Branch naming: `feature/FEATURE_NAME`, `fix/FEATURE_NAME`, `chore/FEATURE_NAME`
- If you are already inside a sibling worktree directory (e.g. `../echos-FEATURE_NAME`) and `git worktree list` shows it as a worktree, proceed
- If you are in the original repo directory (e.g. `echos/`, often on `main`) and have not created a worktree yet — **stop and create one now**
- This rule applies to every task: features, bug fixes, typo corrections, CLAUDE.md edits — everything

**Skipping worktrees is not a shortcut. It is a mistake.**

---

## Project Overview

EchOS is a secure, self-hosted, agent-driven personal knowledge management system. It uses an LLM agent with tools (not rigid command routing) to interact naturally across Telegram, Web, and CLI interfaces.

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
│   ├── cli/          # CLI binary (pnpm echos) — standalone terminal interface
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
Plugins are **auto-discovered** at runtime by `src/plugin-loader.ts` — no manual imports or registration needed.

**CRITICAL — Adding a new plugin checklist (ALWAYS do ALL of these):**
1. Create `plugins/<name>/package.json` with the plugin package
2. Add `plugins/<name>/package.json` to `pnpm-workspace.yaml` (if not glob-matched)
3. Run `pnpm sync-plugins` — this auto-generates `tsconfig.paths.json` (TypeScript path aliases) and ensures root `package.json` has the `"workspace:*"` dependency entry. Without the dep, `pnpm install --prod` in Docker will NOT link the plugin and you get `ERR_MODULE_NOT_FOUND` at runtime

Note: TypeScript path aliases and root `package.json` deps are managed by `pnpm sync-plugins` (step 3). Plugin registration is automatic via `src/plugin-loader.ts` — no manual imports needed. The Dockerfile auto-discovers plugins via `COPY plugins/` — no per-plugin Dockerfile edits are needed.

**CRITICAL — Tool `execute` signatures must always include explicit types (for new/modified tools):**
The `execute` function in `AgentTool` must always have an explicitly typed first parameter to avoid `TS7006` implicit `any` errors in plugin builds where TypeScript path resolution may differ from the root workspace. This applies especially when creating new tools or updating plugins:
```typescript
execute: async (_toolCallId: string, params: Params) => {
  // ...
}
```
Never write `async (_toolCallId, params: Params)` without the `: string` annotation.

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
Interface adapters (Telegram bot and Web UI) implement `InterfaceAdapter` as part of the long-running daemon lifecycle. The CLI (`packages/cli/src/index.ts`) is a separate, standalone entrypoint and does not implement this interface:
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

## Build Verification (MANDATORY before every commit)

**Always run `pnpm -r build` before committing.** TypeScript compilation errors in test files (e.g. unused `@ts-expect-error` directives, type errors in mock code) are caught by `tsc` during the build — not by the test runner alone — because `tsc` includes `*.test.ts` files in the workspace build.

```bash
pnpm -r build   # must pass with zero errors
pnpm vitest run # must pass (or failures must be pre-existing, not introduced)
```

Never commit if `pnpm -r build` reports errors.

## Documentation

After completing any feature work, ALWAYS update the relevant documentation:
- Architecture changes → `docs/ARCHITECTURE.mdx`
- New interfaces or API changes → `docs/INTERFACES.mdx`
- New plugins or plugin changes → `docs/PLUGINS.mdx`
- Deployment changes → `docs/DEPLOYMENT.mdx`
- Security changes → `docs/SECURITY.mdx`
- Setup or configuration changes → `docs/SETUP_FIXES.mdx`
- Categorization logic changes → `docs/CATEGORIZATION.mdx`
- Import/export changes → `docs/KNOWLEDGE_IMPORT.mdx`

Review `docs/TROUBLESHOOTING.mdx` to add any new common issues or solutions.

## Recurring Workflows

Three canonical workflows are defined as skills. Follow them exactly when triggered:

- **Updating the Homebrew formula** → follow `.claude/skills/update-homebrew-formula/SKILL.md`
- **Creating a branch before a PR** → follow `.claude/skills/create-branch/SKILL.md`
- **Reviewing and resolving PR comments** → follow `.claude/skills/review-pr-comments/SKILL.md`

## implement-task: Always Open a PR

When the `implement-task` skill runs (triggered by "implement task X.XX"), **always open a pull request at the end** — no confirmation needed. This overrides the default "don't create PRs unless asked" behaviour. The PR should follow the format defined in Step 11 of the skill.

## Git — Non-interactive Commands

Never let git open an interactive editor (vim, nano, etc.). Always use environment variables or flags to keep git fully non-interactive:

- `git rebase --continue` → prefix with `GIT_EDITOR=true` so the commit message is accepted as-is:
  ```bash
  GIT_EDITOR=true git rebase --continue
  ```
- `git commit` → use `-m "message"` (never rely on the editor fallback)
- `git merge` → use `--no-edit` when the default message is acceptable

## Do NOT

- **Make code changes directly on `main` — always use a git worktree (see top of this file)**
- Use `eval()`, `Function()`, or `vm` module
- Execute shell commands with user input
- Store secrets in code or logs
- Fetch URLs without validation
- Trust content from external sources
- Skip input sanitization
- Use `any` type
- Commit `.env` files
