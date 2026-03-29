FROM node:20.18.0-alpine AS base
# su-exec: lightweight setuid helper for dropping privileges in entrypoints
RUN apk add --no-cache su-exec && \
    corepack enable && corepack prepare pnpm@10.30.1 --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/telegram/package.json packages/telegram/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
COPY packages/scheduler/package.json packages/scheduler/
COPY plugins/article/package.json plugins/article/
COPY plugins/youtube/package.json plugins/youtube/
COPY plugins/content-creation/package.json plugins/content-creation/
COPY plugins/image/package.json plugins/image/
COPY plugins/digest/package.json plugins/digest/
COPY plugins/twitter/package.json plugins/twitter/
COPY plugins/resurface/package.json plugins/resurface/
COPY plugins/journal/package.json plugins/journal/
COPY plugins/pdf/package.json plugins/pdf/
COPY plugins/audio/package.json plugins/audio/
COPY plugins/rss/package.json plugins/rss/
RUN pnpm install --frozen-lockfile --prod=false

# Build
FROM deps AS build
COPY tsconfig.json ./
COPY packages/ packages/
COPY plugins/ plugins/
RUN pnpm build

# Production
FROM base AS production

# Install production Node dependencies (cached unless package.json changes)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY --from=deps /app/packages/shared/package.json packages/shared/
COPY --from=deps /app/packages/core/package.json packages/core/
COPY --from=deps /app/packages/telegram/package.json packages/telegram/
COPY --from=deps /app/packages/web/package.json packages/web/
COPY --from=deps /app/packages/cli/package.json packages/cli/
COPY --from=deps /app/packages/scheduler/package.json packages/scheduler/
COPY --from=deps /app/plugins/article/package.json plugins/article/
COPY --from=deps /app/plugins/youtube/package.json plugins/youtube/
COPY --from=deps /app/plugins/content-creation/package.json plugins/content-creation/
COPY --from=deps /app/plugins/image/package.json plugins/image/
COPY --from=deps /app/plugins/digest/package.json plugins/digest/
COPY --from=deps /app/plugins/twitter/package.json plugins/twitter/
COPY --from=deps /app/plugins/resurface/package.json plugins/resurface/
COPY --from=deps /app/plugins/journal/package.json plugins/journal/
COPY --from=deps /app/plugins/pdf/package.json plugins/pdf/
COPY --from=deps /app/plugins/audio/package.json plugins/audio/
COPY --from=deps /app/plugins/rss/package.json plugins/rss/
RUN pnpm install --prod --frozen-lockfile

# Copy build artifacts (changes frequently, so last)
COPY --from=build /app/packages ./packages/
COPY --from=build /app/plugins ./plugins/
COPY src/ src/

# Runtime directories — owned by node for when the container runs without
# a host volume (e.g. local dev). The entrypoint re-chowns at startup when
# host volume ownership differs.
RUN mkdir -p data/knowledge data/db data/sessions data/logs && \
    chown -R node:node /app

# Copy entrypoint (must run as root to chown, then drops to node via su-exec)
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3000

# Note: the container's default user is root. The entrypoint drops to the
# unprivileged "node" user via su-exec for the main process, but any
# `docker exec` into a running container will be root unless `-u node`
# is explicitly specified.
ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "--import", "tsx", "src/index.ts"]
