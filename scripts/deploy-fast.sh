#!/bin/bash
set -e

# EchOS Fast Docker Deployment
# Builds locally, uploads image to remote server, and deploys.
#
# Usage: ./scripts/deploy-fast.sh [ssh-host]
#   ssh-host: SSH host alias or user@host (default: reads ECHOS_DEPLOY_HOST env var)
#
# Example:
#   ./scripts/deploy-fast.sh my-vps
#   ECHOS_DEPLOY_HOST=user@203.0.113.10 ./scripts/deploy-fast.sh

REMOTE_HOST="${1:-${ECHOS_DEPLOY_HOST:-}}"

if [ -z "$REMOTE_HOST" ]; then
  echo "Usage: $0 <ssh-host>"
  echo "  Or set ECHOS_DEPLOY_HOST env var"
  echo ""
  echo "Examples:"
  echo "  $0 my-vps"
  echo "  $0 user@203.0.113.10"
  exit 1
fi

echo "Fast Docker Deployment - EchOS"
echo "========================================"
echo "Target: $REMOTE_HOST"

# Check if .env file exists
if [ ! -f ".env" ]; then
  echo "Error: .env file not found. Please create it first."
  exit 1
fi

# Build locally first (much faster than building on the remote server)
echo "Building Docker image locally..."
if ! docker build -t echos:latest -f docker/Dockerfile .; then
  echo "Docker build failed!"
  exit 1
fi

# Save image to tar
echo "Saving image to tar..."
if ! docker save echos:latest | gzip > /tmp/echos.tar.gz; then
  echo "Failed to save Docker image!"
  exit 1
fi

echo "Image size: $(du -h /tmp/echos.tar.gz | cut -f1)"

# Create directory structure on remote server
echo "Creating directory structure on remote server..."
if ! ssh "$REMOTE_HOST" 'mkdir -p echos/docker echos/data/{knowledge,db,sessions,logs} && sudo chown -R 1000:1000 echos/data/'; then
  echo "Failed to create directories!"
  rm /tmp/echos.tar.gz
  exit 1
fi

# Copy image, docker-compose, and .env to remote server
echo "Uploading to remote server..."
if ! scp /tmp/echos.tar.gz "$REMOTE_HOST":/tmp/; then
  echo "Failed to upload image!"
  rm /tmp/echos.tar.gz
  exit 1
fi

if ! scp docker/docker-compose.yml "$REMOTE_HOST":echos/docker/; then
  echo "Failed to upload docker-compose.yml!"
  rm /tmp/echos.tar.gz
  exit 1
fi

if ! scp .env "$REMOTE_HOST":echos/; then
  echo "Failed to upload .env!"
  rm /tmp/echos.tar.gz
  exit 1
fi

# Load and deploy on remote server
echo "Loading and deploying on remote server..."
ssh "$REMOTE_HOST" << 'EOF'
cd echos

# Create data directories if they don't exist, owned by node user (uid 1000)
mkdir -p data/knowledge data/db data/sessions data/logs
sudo chown -R 1000:1000 data/

# Load Docker image
echo "Loading Docker image..."
docker load < /tmp/echos.tar.gz

# Stop services
echo "Stopping services..."
cd docker
docker compose down

# Start services
echo "Starting services..."
docker compose up -d

# Clean up
echo "Cleaning up..."
rm /tmp/echos.tar.gz

# Wait for services to be ready
echo "Waiting for services to start..."
sleep 5

# Show status
echo "Deployment complete!"
docker compose ps
echo ""
echo "Recent logs:"
docker compose logs --tail=20 echos
EOF

# Clean up local tar
rm -f /tmp/echos.tar.gz

echo ""
echo "Deployment successful!"
echo "View logs with: ssh $REMOTE_HOST 'cd echos/docker && docker compose logs -f echos'"
echo "Check status with: ssh $REMOTE_HOST 'cd echos/docker && docker compose ps'"
