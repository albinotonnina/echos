# Troubleshooting Guide

## Build and Installation Issues

### Cannot find package '@echos/shared' (or other @echos/* packages)

**Problem**: Workspace packages aren't built or aren't being resolved by tsx.

**Symptoms**:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@echos/shared'
```

**Solutions**:

1. **Build all packages first**:

   ```bash
   pnpm build
   ```

2. **If build fails, clean and rebuild**:

   ```bash
   pnpm clean
   pnpm install
   pnpm build
   ```

3. **Verify path mappings**: The root `tsconfig.json` includes these mappings for tsx:

   ```json
   "paths": {
     "@echos/shared": ["./packages/shared/src/index.ts"],
     "@echos/core": ["./packages/core/src/index.ts"],
     // ... etc
   }
   ```

### LanceDB Native Module Errors

**Problem**: LanceDB native bindings missing for your platform.

**Symptoms**:

```
Error: Cannot find module '@lancedb/lancedb-darwin-x64'
Error: Cannot find module '@lancedb/lancedb-darwin-arm64'
```

**Solutions**:

1. **Intel Macs (darwin-x64)**:
   - The project is configured to use LanceDB `0.22.3` (last version with Intel Mac support)
   - This is set in `packages/core/package.json`
   - If you see this error, run: `pnpm install --force`

2. **Apple Silicon Macs (darwin-arm64)**:
   - Should work with LanceDB `0.26.2+`
   - If issues persist, try: `pnpm install --force`

3. **Linux/Windows**:
   - LanceDB should auto-install the correct native binding
   - Run: `pnpm install --force` if needed

4. **Check what's installed**:

   ```bash
   ls node_modules/.pnpm/@lancedb*/
   ```

### Configuration Errors

**Problem**: Missing required environment variables.

**Symptoms**:

```
Error: Invalid configuration:
  telegramBotToken: Required
  allowedUserIds: Required
  anthropicApiKey: Required
```

**Solution**:

1. Copy the example file:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and fill in required values:

   ```bash
   TELEGRAM_BOT_TOKEN=your_token_from_botfather
   ALLOWED_USER_IDS=123456789,987654321
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   ```

3. Get your Telegram user ID:
   - Message @userinfobot on Telegram
   - Add your ID to `ALLOWED_USER_IDS`

4. Verify the file loads (Node 20.6+):

   ```bash
   # The start script uses --env-file flag
   pnpm start
   ```

## Runtime Issues

### Telegram Bot Conflicts

**Problem**: Multiple bot instances trying to poll Telegram simultaneously.

**Symptoms**:

```
GrammyError: Call to 'getUpdates' failed! (409: Conflict: 
terminated by other getUpdates request; make sure that only 
one bot instance is running)
```

**Solution**:

Only one instance can poll Telegram updates at a time. The conflict can come from:

- Local processes on your machine
- Remote deployments (Oracle Cloud, VPS, etc.)
- Docker containers
- Another developer's machine using the same bot token

#### Step 1: Check local processes

```bash
ps aux | grep "tsx.*index.ts"
# Or more broadly
ps aux | grep echos
# If only the grep command appears, no local instances are running
```

#### Step 2: Check Docker containers

```bash
docker ps | grep echos
# If no output, no containers running
```

#### Step 3: Check bot webhook status

```bash
./scripts/check-telegram-bot.sh status
# Look for "url" field - should be empty "" for polling
```

#### Step 4: Clear webhook and pending updates

```bash
./scripts/check-telegram-bot.sh delete-webhook
# This drops pending updates and allows polling
```

#### Step 5: Check remote deployments

**If you deployed to Oracle Cloud or another server**, check there:

```bash
# SSH to your server
ssh user@your-server

# Check for running processes
ps aux | grep echos

# Check Docker containers
docker ps

# Stop if found
docker compose down
# Or kill the process
pkill -f "tsx.*index.ts"
```

#### Step 6: Wait for timeout

If another instance was recently stopped, Telegram may still have an active long-polling connection (30 second timeout). **Wait 30-60 seconds** then try again.

#### Step 7: Stop all instances

If the conflict persists:

```bash
# Stop local processes
pkill -f "tsx.*index.ts"

# Stop Docker
docker compose down

# Clear webhook
./scripts/check-telegram-bot.sh delete-webhook

# Wait 60 seconds
sleep 60

# Restart
pnpm start
```

**For Production**: Use webhooks instead of long-polling to avoid conflicts:

```bash
# Set webhook URL (HTTPS required)
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=https://your-domain.com/telegram/webhook" \
  -d "secret_token=your_random_secret_here"

# Verify webhook
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

Configure in `.env`:

```bash
TELEGRAM_WEBHOOK_URL=https://your-domain.com/telegram/webhook
TELEGRAM_WEBHOOK_SECRET=your_random_secret_here
```

**Note**: Implementing webhook support requires code changes in `packages/telegram/src/index.ts`.

### Redis Connection Errors

**Problem**: Cannot connect to Redis.

**Symptoms**:

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**Solutions**:

1. **Use the Redis management script** (recommended):

   ```bash
   # Check status
   pnpm redis:status
   
   # Start Redis (auto-detects platform)
   pnpm redis:start
   
   # Verify connection
   pnpm redis:health
   ```

2. **Manual platform-specific start** (if script fails):

   ```bash
   # macOS
   brew services start redis
   
   # Linux (systemd)
   sudo systemctl start redis
   
   # Docker
   docker run -d -p 6379:6379 --name echos-redis redis:7-alpine
   ```

3. **Check Redis URL** in `.env`:

   ```bash
   REDIS_URL=redis://localhost:6379
   ```

4. **Verify Redis is running**:

   ```bash
   redis-cli ping
   # Should return: PONG
   ```

**Note**: Redis is only required when `ENABLE_SCHEDULER=true`. For basic knowledge management, you can disable the scheduler.

### Database/Storage Errors

**Problem**: SQLite or LanceDB initialization failures.

**Symptoms**:

```
Error: unable to open database file
Error: ENOENT: no such file or directory
```

**Solutions**:

1. **Create data directories**:

   ```bash
   mkdir -p data/db data/knowledge data/sessions
   ```

2. **Check permissions**:

   ```bash
   ls -la data/
   # Ensure directories are writable
   ```

3. **Check paths in `.env`**:

   ```bash
   KNOWLEDGE_DIR=./data/knowledge
   DB_PATH=./data/db
   SESSION_DIR=./data/sessions
   ```

4. **Clean state (CAUTION: deletes all data)**:

   ```bash
   rm -rf data/
   mkdir -p data/db data/knowledge data/sessions
   pnpm start
   ```

## Development Issues

### TypeScript Errors

**Problem**: Type errors when editing code.

**Solutions**:

1. **Check all packages**:

   ```bash
   pnpm typecheck
   ```

2. **Rebuild after package changes**:

   ```bash
   pnpm build
   ```

3. **Use watch mode during development**:

   ```bash
   pnpm dev
   ```

### Vitest Test Failures

**Problem**: Tests failing or hanging.

**Solutions**:

1. **Run tests**:

   ```bash
   pnpm test
   ```

2. **Run specific test file**:

   ```bash
   pnpm vitest packages/shared/src/security/url-validator.test.ts
   ```

3. **Watch mode**:

   ```bash
   pnpm test:watch
   ```

## Getting Help

If you're still stuck:

1. **Check the logs**: EchOS uses Pino for structured logging

   ```bash
   pnpm start | pnpm exec pino-pretty
   ```

2. **Enable debug logging**: Set `LOG_LEVEL=debug` in `.env`

3. **Check system requirements**:
   - Node.js 20+ (`node --version`)
   - pnpm 9+ (`pnpm --version`)
   - Redis running (`redis-cli ping`)
   - Enough disk space for embeddings/vectors

4. **Review security docs**: See [SECURITY.md](./SECURITY.md)

5. **Architecture overview**: See [ARCHITECTURE.md](./ARCHITECTURE.md)
