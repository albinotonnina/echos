# Deployment

> **Troubleshooting?** See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common issues and solutions.
> **Interface Usage?** See [INTERFACES.md](./INTERFACES.md) for accessing Telegram, Web API, and TUI.

## Prerequisites

- Docker and Docker Compose
- `.env` file with required variables (see `.env.example`)

## Docker Compose (Recommended)

```bash
# Build and start
cd docker
docker compose up -d --build

# View logs
docker compose logs -f echos

# Stop
docker compose down
```

This starts 2 services:
- **redis**: Redis 7 for BullMQ job queue
- **echos**: The EchOS application

Data is persisted via volume mounts to `./data/`.

## Manual Deployment

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start (requires Redis running)
pnpm start
```

### Troubleshooting

#### Module Not Found Errors

If you see `Cannot find package '@echos/shared'` or `'@echos/plugin-youtube'` or similar:

```bash
# Rebuild all workspace packages
pnpm build

# Or if that fails, clean and rebuild
pnpm clean
pnpm install
pnpm build
```

#### LanceDB Native Module Errors

If you see `Cannot find module '@lancedb/lancedb-darwin-x64'` or similar:

1. **Intel Macs**: The project uses LanceDB 0.22.3 (configured in `packages/core/package.json`)
2. **ARM Macs/Linux**: LanceDB should install the correct native binding automatically
3. **Force reinstall**: `pnpm install --force`

#### Telegram Bot Conflicts

Error: `Conflict: terminated by other getUpdates request`

This means another instance of your bot is already running. Only one instance can poll Telegram.

**Solution:**

```bash
# Stop all echos processes
pkill -f "tsx.*index.ts"

# Or find the specific process
ps aux | grep "tsx"
kill <PID>

# Verify nothing is running (should only show "grep echos")
ps aux | grep echos

# Then restart
pnpm start
```

**For production**: Use webhooks instead of polling to avoid conflicts.

## Oracle Cloud Deployment

```bash
# Deploy to remote server
./scripts/deploy.sh user@your-server-ip
```

The deploy script:
1. Syncs project files via rsync
2. Installs dependencies on remote
3. Builds the project
4. Restarts via docker-compose

### Important: Dev vs Production

**Before starting locally**, ensure your production deployment is stopped:

```bash
# SSH to production
ssh user@your-server

# Stop the bot
docker compose down
# Or
pkill -f "echos"

# Exit SSH
exit

# Now safe to start locally
pnpm start
```

Only one instance can poll Telegram at a time. See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#telegram-bot-conflicts) for details.

## Backup

```bash
# Create backup
./scripts/backup.sh ./backups

# Restore (copy files back)
tar -xzf backups/echos_backup_TIMESTAMP.tar.gz
```

## Environment Variables

See `.env.example` for the full list. Required:
- `TELEGRAM_BOT_TOKEN` - Get from @BotFather on Telegram
- `ALLOWED_USER_IDS` - Comma-separated Telegram user IDs (get from @userinfobot)
- `ANTHROPIC_API_KEY` - Get from https://console.anthropic.com/

Optional but recommended:
- `OPENAI_API_KEY` - Required for embeddings and Whisper transcription

Scheduler (requires Redis):
- `ENABLE_SCHEDULER` - Set to `true` to enable background jobs (default: `false`)
- `DIGEST_SCHEDULE` - Cron expression for AI daily digest (e.g. `0 8 * * *` for 8am daily)
- `REMINDER_CHECK_SCHEDULE` - Cron expression for due reminder checks (e.g. `*/15 * * * *` for every 15min)

See [SCHEDULER.md](./SCHEDULER.md) for details.

## Process Management

### Development

```bash
# Start (foreground)
pnpm start

# Stop (Ctrl+C or from another terminal)
pkill -f "tsx.*index.ts"
```

### Production

For production deployments, use a process manager:

```bash
# With PM2
pm2 start "pnpm start" --name echos
pm2 stop echos
pm2 restart echos
pm2 logs echos

# Or use Docker Compose (recommended)
docker compose up -d
docker compose logs -f echos
docker compose stop
```
