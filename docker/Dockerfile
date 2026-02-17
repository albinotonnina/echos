FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/telegram/package.json packages/telegram/
COPY packages/web/package.json packages/web/
COPY packages/tui/package.json packages/tui/
COPY packages/scheduler/package.json packages/scheduler/
COPY plugins/article/package.json plugins/article/
COPY plugins/youtube/package.json plugins/youtube/
COPY plugins/content-creation/package.json plugins/content-creation/
RUN pnpm install --frozen-lockfile --prod=false

# Build
FROM deps AS build
COPY tsconfig.json ./
COPY packages/ packages/
COPY plugins/ plugins/
RUN pnpm build

# Production
FROM base AS production

# Install Python 3 and youtube-transcript-api early (better caching)
RUN apk add --no-cache python3 py3-pip && \
    pip3 install --no-cache-dir --break-system-packages youtube-transcript-api yt-dlp

# Install production Node dependencies first (cached unless package.json changes)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY --from=deps /app/packages/shared/package.json packages/shared/
COPY --from=deps /app/packages/core/package.json packages/core/
COPY --from=deps /app/packages/telegram/package.json packages/telegram/
COPY --from=deps /app/packages/web/package.json packages/web/
COPY --from=deps /app/packages/tui/package.json packages/tui/
COPY --from=deps /app/packages/scheduler/package.json packages/scheduler/
COPY --from=deps /app/plugins/article/package.json plugins/article/
COPY --from=deps /app/plugins/youtube/package.json plugins/youtube/
COPY --from=deps /app/plugins/content-creation/package.json plugins/content-creation/
RUN pnpm install --prod --frozen-lockfile

# Copy build artifacts (changes frequently, so last)
COPY --from=build /app/packages ./packages/
COPY --from=build /app/plugins ./plugins/
COPY src/ src/

# Runtime directories
RUN mkdir -p data/knowledge data/db data/sessions data/logs && \
    chown -R node:node /app

# Switch to non-root user for security
USER node

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "--import", "tsx", "src/index.ts"]
