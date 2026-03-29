# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
# su-exec: lightweight setuid helper for dropping privileges in entrypoints
# Upgrade corepack first — bundled version may have stale signing keys
RUN apk add --no-cache su-exec && \
    npm i -g corepack && corepack enable && corepack prepare pnpm@10.30.1 --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
# Build tools for native modules (better-sqlite3) when prebuilds are
# unavailable for the current Node point release.
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/telegram/package.json packages/telegram/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
COPY packages/scheduler/package.json packages/scheduler/
COPY --parents plugins/*/package.json ./
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
COPY --from=deps /app/plugins/ plugins/
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
