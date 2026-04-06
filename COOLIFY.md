# Deploying EchOS to Coolify

## Quick Setup

1. **Connect Coolify to GitHub**
   - In Coolify dashboard → Sources → Add GitHub source
   - Follow OAuth flow to grant repository access

2. **Create New Resource**
   - Click "Add Resource" → Select your GitHub repository `echos`
   - Coolify will auto-detect `docker-compose.yml` and suggest deployment settings

3. **Configure Environment Variables**
   In Coolify → Your EchOS resource → Environment Variables, add:

   | Variable | Description | Example |
   |----------|-------------|---------|
   | `TELEGRAM_BOT_TOKEN` | Your Telegram bot token | `123456:ABC-DEF...` |
   | `ALLOWED_USER_IDS` | Your Telegram user ID(s) | `525849733` |
   | `LLM_API_KEY` | Groq API key | `gsk_xxxx...` |
   | `STT_API_KEY` | Groq API key (for Whisper) | `gsk_xxxx...` |
   | `OPENAI_API_KEY` | OpenAI key (for embeddings) | `sk-proj-...` |
   | `WEB_API_KEY` | Web API authentication key | `your-secure-key` |

   All other variables have sensible defaults.

4. **Set Persistent Storage**
   - In Coolify → Your EchOS resource → Storage
   - Ensure `/data` is mapped to a persistent volume
   - Coolify auto-creates volumes from `docker-compose.yml`

5. **Deploy**
   - Click "Deploy"
   - First build takes ~5-10 minutes (pnpm install + TypeScript compile)
   - Subsequent deploys are much faster with layer caching

## Environment Variables Reference

### Required
- `TELEGRAM_BOT_TOKEN` — Telegram bot token from @BotFather
- `ALLOWED_USER_IDS` — Comma-separated Telegram user IDs allowed to use the bot
- `LLM_API_KEY` — Groq API key (get from https://console.groq.com/keys)
- `STT_API_KEY` — Groq API key for speech-to-text (same as LLM_API_KEY works)

### Optional (with defaults)
| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_MODEL` | `openai/gpt-oss-120b` | LLM model to use |
| `LLM_BASE_URL` | `https://api.groq.com/openai/v1` | Groq API endpoint |
| `MAX_CONTEXT_TOKENS` | `6000` | Context window size (use 6000 for Groq free tier) |
| `ENABLE_TELEGRAM` | `true` | Enable Telegram bot interface |
| `ENABLE_WEB` | `true` | Enable Web API |
| `WEB_PORT` | `3000` | Web API port |
| `BACKUP_ENABLED` | `true` | Enable automated backups |
| `BACKUP_CRON` | `0 2 * * *` | Backup schedule (daily at 2 AM) |
| `LOG_LLM_PAYLOADS` | `false` | Log LLM request payloads for debugging |

## Ports
- `3000` — Web API (for programmatic access)
- Telegram bot uses polling (no port needed)

## Persistent Data
The following directories are persisted via Docker volumes:
- `/data/knowledge` — Markdown notes
- `/data/db` — SQLite database + vectors
- `/data/sessions` — User sessions
- `/data/backups` — Automated backups
- `redis-data` — Redis data for scheduler/queue

## Troubleshooting

### Check logs
```bash
docker logs echos --tail 50 -f
```

### Restart service
```bash
docker restart echos
```

### Check Redis health
```bash
docker exec echos-redis redis-cli ping
```

### View environment
```bash
docker exec echos env
```
