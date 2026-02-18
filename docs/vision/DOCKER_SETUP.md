# Docker Setup for Knowledge Agent

## docker-compose.yml

```yaml
version: '3.8'

services:
  # Main agent service (runs Telegram bot, agent core)
  agent:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: knowledge-agent
    environment:
      # LLM API Keys
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      
      # Telegram
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - TELEGRAM_WEBHOOK_URL=${TELEGRAM_WEBHOOK_URL:-}
      
      # Paths
      - KNOWLEDGE_DIR=/app/knowledge
      - SESSION_DIR=/app/sessions
      - DB_PATH=/app/db/knowledge.db
      
      # Agent settings
      - DEFAULT_MODEL=claude-3-5-haiku-20241022
      - EMBEDDING_MODEL=text-embedding-3-small
      - NODE_ENV=production
      
      # Features
      - ENABLE_WEB_UI=true
      - ENABLE_TUI=false  # Not needed in Docker
      - ENABLE_TELEGRAM=true
      
      # Optional: User whitelist
      - ALLOWED_TELEGRAM_USERS=${ALLOWED_TELEGRAM_USERS:-}
    
    volumes:
      # Persistent data
      - ./data/knowledge:/app/knowledge
      - ./data/sessions:/app/sessions
      - ./data/db:/app/db
      
      # Plugins (optional)
      - ./plugins:/app/plugins
      
      # Config (optional)
      - ./config:/app/config
    
    restart: unless-stopped
    
    networks:
      - knowledge-net
    
    # Health check
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3001/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
  
  # Web UI (optional, can be disabled)
  web:
    build:
      context: .
      dockerfile: Dockerfile.web
    container_name: knowledge-web
    environment:
      - AGENT_URL=http://agent:3001
      - PORT=3000
    
    ports:
      - "3000:3000"
    
    depends_on:
      agent:
        condition: service_healthy
    
    restart: unless-stopped
    
    networks:
      - knowledge-net
    
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

networks:
  knowledge-net:
    driver: bridge

volumes:
  knowledge-data:
  session-data:
  db-data:
```

## Dockerfile (Agent)

```dockerfile
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Build stage
FROM base AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 agent

# Copy dependencies and built app
COPY --from=deps --chown=agent:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=agent:nodejs /app/dist ./dist
COPY --from=builder --chown=agent:nodejs /app/package.json ./

# Create data directories
RUN mkdir -p /app/knowledge /app/sessions /app/db /app/plugins
RUN chown -R agent:nodejs /app

USER agent

EXPOSE 3001

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "dist/index.js"]
```

## Dockerfile.web (Web UI)

```dockerfile
FROM node:20-alpine AS base

# Dependencies
FROM base AS deps
WORKDIR /app

COPY packages/web/package*.json ./
RUN npm ci --only=production

# Builder
FROM base AS builder
WORKDIR /app

COPY packages/web/package*.json ./
RUN npm ci

COPY packages/web/ .
RUN npm run build

# Runner
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 webui

COPY --from=deps --chown=webui:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=webui:nodejs /app/.next ./.next
COPY --from=builder --chown=webui:nodejs /app/public ./public
COPY --from=builder --chown=webui:nodejs /app/package.json ./

USER webui

EXPOSE 3000

CMD ["npm", "start"]
```

## .env.example

```bash
# ============================================================================
# LLM API Keys
# ============================================================================
ANTHROPIC_API_KEY=sk-ant-xxxxx
OPENAI_API_KEY=sk-xxxxx  # Optional, for embeddings

# ============================================================================
# Telegram Bot
# ============================================================================
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
# Optional: Webhook URL for Telegram (leave empty for polling)
TELEGRAM_WEBHOOK_URL=

# Optional: Whitelist of allowed Telegram user IDs (comma-separated)
# Leave empty to allow all users
ALLOWED_TELEGRAM_USERS=

# ============================================================================
# Storage Paths (Docker paths - don't change unless you know what you're doing)
# ============================================================================
KNOWLEDGE_DIR=/app/knowledge
SESSION_DIR=/app/sessions
DB_PATH=/app/db/knowledge.db

# ============================================================================
# Agent Settings
# ============================================================================
# Default model for agent
DEFAULT_MODEL=claude-3-5-haiku-20241022

# Model for generating embeddings
EMBEDDING_MODEL=text-embedding-3-small

# Max tokens for agent responses
MAX_TOKENS=4096

# Temperature (0.0 - 1.0)
TEMPERATURE=0.7

# ============================================================================
# Features
# ============================================================================
ENABLE_WEB_UI=true
ENABLE_TUI=false  # Not useful in Docker
ENABLE_TELEGRAM=true

# ============================================================================
# Advanced Settings
# ============================================================================
# Log level: debug, info, warn, error
LOG_LEVEL=info

# Enable cost tracking
TRACK_COSTS=true

# Database settings
SQLITE_BUSY_TIMEOUT=5000
ENABLE_WAL_MODE=true

# Vector DB settings (if using LanceDB)
VECTOR_DB_PATH=/app/db/vectors

# Embedding batch size
EMBEDDING_BATCH_SIZE=100

# Search result limit
DEFAULT_SEARCH_LIMIT=10

# ============================================================================
# Optional: External Services
# ============================================================================
# Redis for caching (optional)
# REDIS_URL=redis://localhost:6379

# S3 for backups (optional)
# S3_BUCKET=
# S3_ACCESS_KEY=
# S3_SECRET_KEY=
# S3_REGION=
```

## .dockerignore

```
node_modules
npm-debug.log
dist
.git
.env
.env.local
data/
*.md
!README.md
.vscode
.idea
coverage
.DS_Store
```

## Deployment Instructions

### Local Development

```bash
# 1. Copy environment file
cp .env.example .env

# 2. Edit .env with your API keys
nano .env

# 3. Build and run
docker-compose up --build

# 4. Access
# - Telegram: Message your bot
# - Web UI: http://localhost:3000
```

### Production (Oracle Cloud / VPS)

```bash
# 1. SSH into server
ssh user@your-server-ip

# 2. Clone repository
git clone https://github.com/yourusername/knowledge-agent.git
cd knowledge-agent

# 3. Set up environment
cp .env.example .env
nano .env  # Add your API keys

# 4. Create data directories
mkdir -p data/{knowledge,sessions,db}

# 5. Build and run in detached mode
docker-compose up -d --build

# 6. View logs
docker-compose logs -f

# 7. Check status
docker-compose ps

# 8. Optional: Set up Cloudflare Tunnel for web UI
```

### Updating

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker-compose down
docker-compose up -d --build

# Clean old images
docker image prune
```

### Backup

```bash
# Backup script (add to cron)
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="./backups"
mkdir -p $BACKUP_DIR

# Backup knowledge files
tar -czf $BACKUP_DIR/knowledge_$DATE.tar.gz data/knowledge/

# Backup database
sqlite3 data/db/knowledge.db ".backup $BACKUP_DIR/db_$DATE.sqlite"

# Keep only last 7 days
find $BACKUP_DIR -name "knowledge_*.tar.gz" -mtime +7 -delete
find $BACKUP_DIR -name "db_*.sqlite" -mtime +7 -delete

echo "Backup completed: $DATE"
```

### Monitoring

```bash
# View logs
docker-compose logs -f agent
docker-compose logs -f web

# Check resource usage
docker stats

# Enter container for debugging
docker-compose exec agent sh

# Check health
curl http://localhost:3001/health
```

### Cloudflare Tunnel (Optional)

For exposing web UI without opening ports:

```bash
# 1. Install cloudflared
# Follow: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/

# 2. Authenticate
cloudflared tunnel login

# 3. Create tunnel
cloudflared tunnel create knowledge-agent

# 4. Configure tunnel
# Create config file: ~/.cloudflared/config.yml
tunnel: <TUNNEL-ID>
credentials-file: /root/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: knowledge.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404

# 5. Route DNS
cloudflared tunnel route dns knowledge-agent knowledge.yourdomain.com

# 6. Run tunnel
cloudflared tunnel run knowledge-agent

# Or run as service
cloudflared service install
```

### Security Checklist

- [ ] Change default ports if needed
- [ ] Set up firewall rules
- [ ] Use strong API keys
- [ ] Enable Telegram user whitelist in production
- [ ] Regular backups automated
- [ ] HTTPS for web UI (via Cloudflare or reverse proxy)
- [ ] Keep Docker images updated
- [ ] Monitor logs for suspicious activity
- [ ] Limit container resources if needed

### Troubleshooting

**Agent won't start:**
```bash
# Check logs
docker-compose logs agent

# Verify environment variables
docker-compose exec agent printenv

# Check file permissions
ls -la data/
```

**High memory usage:**
```bash
# Limit container memory in docker-compose.yml
services:
  agent:
    deploy:
      resources:
        limits:
          memory: 2G
```

**Telegram bot not responding:**
```bash
# Check bot token
curl https://api.telegram.org/bot<TOKEN>/getMe

# Check webhook status
curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo

# Clear webhook if using polling
curl https://api.telegram.org/bot<TOKEN>/deleteWebhook
```

**Database locked:**
```bash
# Enable WAL mode (should be default)
# Check .env: ENABLE_WAL_MODE=true

# Or manually:
docker-compose exec agent sqlite3 /app/db/knowledge.db "PRAGMA journal_mode=WAL;"
```
