#!/bin/bash
set -euo pipefail

# EchOS deploy script for Oracle Cloud
# Usage: ./scripts/deploy.sh [user@host]

REMOTE="${1:-}"
APP_DIR="/opt/echos"

if [ -z "$REMOTE" ]; then
  echo "Usage: $0 user@host"
  exit 1
fi

echo "Deploying EchOS to $REMOTE..."

# Sync project files
rsync -avz --exclude='node_modules' --exclude='dist' --exclude='data' \
  --exclude='.git' --exclude='.env' \
  ./ "$REMOTE:$APP_DIR/"

# Build and restart on remote
ssh "$REMOTE" bash -s <<'EOF'
  cd /opt/echos

  # Install pnpm if needed
  command -v pnpm >/dev/null 2>&1 || npm install -g pnpm

  # Install deps and build
  pnpm install --frozen-lockfile
  pnpm build

  # Restart via docker-compose
  cd docker
  docker compose down
  docker compose up -d --build

  # Wait for health check
  echo "Waiting for services..."
  sleep 5
  docker compose ps

  echo "Deploy complete!"
EOF
