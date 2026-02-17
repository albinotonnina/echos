#!/bin/bash
set -e

echo "🚀 Fast Oracle Cloud Deployment - EchOS"
echo "========================================"

# Check if .env file exists
if [ ! -f ".env" ]; then
  echo "❌ Error: .env file not found. Please create it first."
  exit 1
fi

# Build locally first (much faster than on Oracle Cloud)
echo "📦 Building Docker image locally..."
if ! docker build -t echos:latest -f docker/Dockerfile .; then
  echo "❌ Docker build failed!"
  exit 1
fi

# Save image to tar
echo "💾 Saving image to tar..."
if ! docker save echos:latest | gzip > /tmp/echos.tar.gz; then
  echo "❌ Failed to save Docker image!"
  exit 1
fi

echo "📏 Image size: $(du -h /tmp/echos.tar.gz | cut -f1)"

# Create directory structure on Oracle Cloud
echo "📁 Creating directory structure on Oracle Cloud..."
if ! ssh oracle-cloud 'mkdir -p echos/docker echos/data/{knowledge,db,sessions,logs}'; then
  echo "❌ Failed to create directories!"
  rm /tmp/echos.tar.gz
  exit 1
fi

# Copy image, docker-compose, and .env to Oracle Cloud
echo "📤 Uploading to Oracle Cloud..."
if ! scp /tmp/echos.tar.gz oracle-cloud:/tmp/; then
  echo "❌ Failed to upload image!"
  rm /tmp/echos.tar.gz
  exit 1
fi

if ! scp docker/docker-compose.yml oracle-cloud:echos/docker/; then
  echo "❌ Failed to upload docker-compose.yml!"
  rm /tmp/echos.tar.gz
  exit 1
fi

if ! scp .env oracle-cloud:echos/; then
  echo "❌ Failed to upload .env!"
  rm /tmp/echos.tar.gz
  exit 1
fi

# Load and deploy on Oracle Cloud
echo "🔄 Loading and deploying on Oracle Cloud..."
ssh oracle-cloud << 'EOF'
cd echos

# Create data directories if they don't exist
mkdir -p data/knowledge data/db data/sessions data/logs

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
echo "✅ Deployment complete!"
docker compose ps
echo ""
echo "Recent logs:"
docker compose logs --tail=20 echos
EOF

# Clean up local tar
rm -f /tmp/echos.tar.gz

echo ""
echo "✅ Deployment successful!"
echo "View logs with: ssh oracle-cloud 'cd echos/docker && docker compose logs -f echos'"
echo "Check status with: ssh oracle-cloud 'cd echos/docker && docker compose ps'"
