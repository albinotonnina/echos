# Setup Fixes & Configuration Changes

This document tracks configuration changes and fixes made to ensure the project runs correctly.

## February 15, 2026 - Initial Setup Fixes

### Issues Fixed

1. **Workspace Package Resolution**
   - **Problem**: tsx couldn't resolve `@echos/*` workspace packages when running `src/index.ts`
   - **Solution**: Added TypeScript path mappings to root `tsconfig.json`
   - **Files changed**: `tsconfig.json`
   - **Details**: Added `paths` configuration mapping all `@echos/*` packages to their source locations

2. **LanceDB Native Module Compatibility**
   - **Problem**: LanceDB 0.26.2 dropped support for Intel Macs (darwin-x64)
   - **Solution**: Downgraded to LanceDB 0.22.3
   - **Files changed**: `packages/core/package.json`
   - **Details**: Changed `"@lancedb/lancedb": "^0.26.2"` to `"^0.22.3"`

3. **Environment File Loading**
   - **Problem**: Environment variables weren't being loaded from `.env` file
   - **Solution**: Added `--env-file` flag to start script (Node 20.6+ feature)
   - **Files changed**: `package.json`
   - **Details**: Changed `"start": "tsx src/index.ts"` to `"tsx --env-file=.env src/index.ts"`

### Configuration Changes

#### tsconfig.json (Root)

Added path mappings for workspace packages:

```json
{
  "compilerOptions": {
    // ... existing config
    "paths": {
      "@echos/shared": ["./packages/shared/src/index.ts"],
      "@echos/shared/*": ["./packages/shared/src/*"],
      "@echos/core": ["./packages/core/src/index.ts"],
      "@echos/core/*": ["./packages/core/src/*"],
      "@echos/telegram": ["./packages/telegram/src/index.ts"],
      "@echos/web": ["./packages/web/src/index.ts"],
      "@echos/tui": ["./packages/tui/src/index.ts"],
      "@echos/scheduler": ["./packages/scheduler/src/index.ts"]
    }
  }
}
```

**Why**: tsx needs explicit path mappings to resolve pnpm workspace packages when running TypeScript files directly.

#### packages/core/package.json

Changed LanceDB version:

```json
{
  "dependencies": {
    "@lancedb/lancedb": "^0.22.3"  // was "^0.26.2"
  }
}
```

**Why**: LanceDB 0.26.2 removed darwin-x64 (Intel Mac) native bindings. Version 0.22.3 is the latest with full macOS support.

#### package.json (Root)

Updated start script:

```json
{
  "scripts": {
    "start": "tsx --env-file=.env src/index.ts"  // was "tsx src/index.ts"
  }
}
```

**Why**: Node.js 20.6+ supports native `.env` file loading via the `--env-file` flag, eliminating the need for dotenv packages.

### Build Process

The correct startup sequence is:

1. **Install dependencies**: `pnpm install`
2. **Build all packages**: `pnpm build` (required on first run and after any package changes)
3. **Configure environment**: Edit `.env` file with API keys
4. **Start application**: `pnpm start`

### Known Issues

#### Telegram Bot Conflicts

**Symptom**: `GrammyError: Call to 'getUpdates' failed! (409: Conflict)`

**Cause**: Another instance of the bot is already running. Telegram allows only one instance to poll for updates.

**Fix**: 
```bash
pkill -f "tsx.*index.ts"
pnpm start
```

**Prevention**: For production, use webhooks instead of polling.

### Documentation Updates

- `README.md`: Added first-time setup notes and process management instructions
- `docs/DEPLOYMENT.md`: Added troubleshooting section and process management guide
- `docs/TROUBLESHOOTING.md`: New comprehensive troubleshooting guide
- `docs/SETUP_FIXES.md`: This file

### Environment Variables

Required variables (must be set in `.env`):
- `TELEGRAM_BOT_TOKEN` - From @BotFather
- `ALLOWED_USER_IDS` - Comma-separated Telegram user IDs
- `ANTHROPIC_API_KEY` - From Anthropic Console

Optional but recommended:
- `OPENAI_API_KEY` - For embeddings and Whisper

See `.env.example` for full list with defaults.

### Verification Steps

To verify the setup is working:

1. **Check Node version**: `node --version` (should be 20+)
2. **Check pnpm version**: `pnpm --version` (should be 9+)
3. **Check packages built**: `ls packages/*/dist` (should show compiled JS files)
4. **Check Redis running**: `redis-cli ping` (should return PONG)
5. **Check env file**: `head .env` (should show configured values, without secrets!)
6. **Start application**: `pnpm start` (should start without errors)

### Available Commands

- `pnpm start` - Start all enabled interfaces (Telegram + Web + TUI if enabled)
- `pnpm start:web-only` - Start only the Web API (port 3000)
- `pnpm start:tui-only` - Start only the Terminal UI (interactive prompt)
- `pnpm cli` - Run the standalone CLI tool for testing
- `pnpm dev` - Watch mode for development (rebuilds on changes)
- `pnpm test` - Run all tests
- `pnpm build` - Build all workspace packages

See [docs/INTERFACES.md](./INTERFACES.md) for interface usage details.

### Platform-Specific Notes

#### macOS (Intel)
- Uses LanceDB 0.22.3 with darwin-x64 native bindings
- Run `pnpm install --force` if native module errors occur

#### macOS (Apple Silicon)
- Could use newer LanceDB versions if needed
- Current version (0.22.3) works on both architectures

#### Linux
- Should work with LanceDB 0.22.3 or newer
- Native bindings auto-detected by platform

#### Windows
- Not extensively tested but should work
- May need WSL for better compatibility

### Future Improvements

- [ ] Consider using PM2 or similar for process management
- [ ] Add webhook support for Telegram (production recommended)
- [ ] Create systemd service file for Linux deployments
- [ ] Add health check endpoint for monitoring
- [ ] Document upgrade path for LanceDB when arm64 stability improves
