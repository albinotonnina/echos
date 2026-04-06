# syntax=docker/dockerfile:1
FROM node:20-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

# Install system dependencies
RUN apk add --no-cache git redis

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.paths.json vitest.config.ts ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/telegram/package.json packages/telegram/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
COPY packages/scheduler/package.json packages/scheduler/
COPY plugins/audio/package.json plugins/audio/
COPY plugins/article/package.json plugins/article/
COPY plugins/content-creation/package.json plugins/content-creation/
COPY plugins/digest/package.json plugins/digest/
COPY plugins/image/package.json plugins/image/
COPY plugins/journal/package.json plugins/journal/
COPY plugins/pdf/package.json plugins/pdf/
COPY plugins/resurface/package.json plugins/resurface/
COPY plugins/rss/package.json plugins/rss/
COPY plugins/twitter/package.json plugins/twitter/
COPY plugins/youtube/package.json plugins/youtube/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

# Build all packages
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/plugins ./plugins
COPY . .
RUN pnpm build

# Production runner
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV ECHOS_HOME=/data
ENV REDIS_URL=redis://redis:6379

# Copy built artifacts and production dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/plugins ./plugins
COPY --from=builder /app/src ./src
COPY package.json pnpm-workspace.yaml tsconfig.json tsconfig.paths.json ./

# Create data directory
RUN mkdir -p /data/knowledge /data/db /data/sessions /data/backups /data/exports

EXPOSE 3000

# Write .env file from environment variables and start
# Coolify injects environment variables, which get written to .env for tsx
CMD sh -c 'env | grep -v "HOME\|HOSTNAME\|PATH\|TERM" | grep "=" > /tmp/generated.env && npx tsx --env-file=/tmp/generated.env src/index.ts'
