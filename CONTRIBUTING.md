# Contributing to EchOS

Thanks for your interest in contributing! EchOS is a personal knowledge management system — contributions that improve it for self-hosters are very welcome.

## Before you start

- Check existing [issues](https://github.com/albinotonnina/echos/issues) and [PRs](https://github.com/albinotonnina/echos/pulls) to avoid duplicate work
- For significant changes, open an issue first to discuss the approach
- EchOS is security-sensitive — read [docs/SECURITY](https://docs.echos.sh/security) before touching auth, URL fetching, or storage

## Prerequisites

- **POSIX shell** (bash/zsh) — pnpm scripts use shell parameter expansion (`${ECHOS_HOME:-$HOME/echos}`). Windows `cmd.exe` and PowerShell are not supported; use WSL.
- **Node.js 20+** and **pnpm 9+**
- **Redis** (for BullMQ job queue)

## Setup

```bash
git clone https://github.com/albinotonnina/echos.git && cd echos
pnpm install
pnpm wizard          # configure your .env
pnpm build
pnpm start
```

## Development workflow

```bash
pnpm dev             # watch mode — rebuilds packages on change
pnpm test            # run tests
pnpm typecheck       # TypeScript strict check across all packages
pnpm lint            # ESLint
```

CI runs `typecheck` and `test` on every PR. Both must pass.

## Project structure

```
packages/shared/     — types, config (Zod), security utils, logging
packages/core/       — agent, tools, storage, search, plugin system
packages/telegram/   — Telegram bot adapter (grammY)
packages/web/        — Web UI adapter (Fastify + SSE)
packages/cli/        — CLI binary (`pnpm echos`) — standalone terminal interface
packages/scheduler/  — Background jobs (BullMQ)
plugins/youtube/     — YouTube transcript plugin
plugins/article/     — Web article plugin
scripts/             — setup wizard, updater, reconciler
```

## Adding a plugin

Plugins are the right place for new content sources. See [docs/PLUGINS](https://docs.echos.sh/plugins) for the full guide. The short version:

```typescript
import type { EchosPlugin } from '@echos/core';

const myPlugin: EchosPlugin = {
  name: 'my-source',
  version: '0.1.0',
  description: 'Processes X content',
  setup(context) {
    return [createMyTool(context)];
  },
};
export default myPlugin;
```

## Code style

- TypeScript strict mode, ESM, no `any`
- Explicit return types on exported functions
- `async/await` over callbacks
- Use error classes from `@echos/shared/errors`
- Use `createLogger(name)` from `@echos/shared/logging` — never `console.log` in library code
- Validate all external input with Zod

## Security requirements (non-negotiable)

- Validate all URLs with `validateUrl()` before fetching (SSRF prevention)
- Sanitize all external HTML with `sanitizeHtml()`
- Never log API keys, tokens, or user content at debug level
- Never use `eval()`, `Function()`, or execute AI-generated code
- Rate limit any new user-facing endpoint

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add RSS feed plugin
fix: handle undefined cron schedule in wizard
docs: update DEPLOYMENT.md with nginx SSL steps
chore: bump @clack/prompts to 0.9.2
```

Conventional commit prefixes drive the auto-generated release changelog.

## Releases

Maintainer-only. Tag a version → GitHub Actions does the rest:

```bash
git tag v0.3.0 && git push origin v0.3.0
```

This triggers:
1. Multi-arch Docker build → pushed to `ghcr.io/albinotonnina/echos`
2. GitHub Release created with auto-generated changelog
3. Production VPS instance updated (if deploy secrets are configured)

## License

By contributing, you agree your contributions will be licensed under MIT.
