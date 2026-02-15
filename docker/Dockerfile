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
RUN pnpm install --frozen-lockfile --prod=false

# Build
FROM deps AS build
COPY tsconfig.json ./
COPY packages/ packages/
RUN pnpm build

# Production
FROM base AS production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/*/node_modules ./packages/*/node_modules || true
COPY --from=build /app/packages/*/dist ./packages/*/dist
COPY --from=build /app/packages/*/package.json ./packages/*/package.json
COPY package.json pnpm-workspace.yaml ./
COPY src/ src/

# Runtime directories
RUN mkdir -p data/knowledge data/db data/sessions data/logs

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "--import", "tsx", "src/index.ts"]
