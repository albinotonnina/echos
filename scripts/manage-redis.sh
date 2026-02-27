#!/usr/bin/env bash
#
# Manage Redis server for local development
# Usage: ./scripts/manage-redis.sh [command]
# Commands: status, start, stop, health

set -euo pipefail

# Load REDIS_URL from .env if present
REDIS_URL="${REDIS_URL:-}"
if [ -z "$REDIS_URL" ] && [ -f .env ]; then
    REDIS_URL=$(grep '^REDIS_URL=' .env 2>/dev/null | cut -d '=' -f2- || echo "redis://localhost:6379")
fi
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
REDIS_HOST=$(echo "$REDIS_URL" | sed -E 's|redis://([^:]+):.*|\1|')
REDIS_PORT=$(echo "$REDIS_URL" | sed -E 's|redis://[^:]+:([0-9]+).*|\1|')

# Detect platform
detect_platform() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "linux"
    else
        echo "unknown"
    fi
}

# Check if Redis is running
is_redis_running() {
    redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping &>/dev/null
}

# Check if brew Redis service is running
is_brew_redis_running() {
    brew services list 2>/dev/null | grep redis | grep started &>/dev/null
}

# Check if systemd Redis service is running
is_systemd_redis_running() {
    systemctl is-active redis &>/dev/null || systemctl is-active redis-server &>/dev/null
}

# Check if Docker Redis container is running
is_docker_redis_running() {
    docker ps --filter "name=redis" --filter "status=running" --format "{{.Names}}" 2>/dev/null | grep -q redis
}

command="${1:-status}"

case "$command" in
    status)
        echo "=== Redis Status ==="
        echo "Connection: $REDIS_URL"
        echo ""
        
        if is_redis_running; then
            echo "✅ Redis is running and accepting connections"
            echo ""
            
            # Try to identify how Redis is running
            platform=$(detect_platform)
            if [[ "$platform" == "macos" ]] && is_brew_redis_running; then
                echo "Running via: Homebrew service"
            elif [[ "$platform" == "linux" ]] && is_systemd_redis_running; then
                echo "Running via: systemd service"
            elif is_docker_redis_running; then
                echo "Running via: Docker container"
            else
                echo "Running via: Unknown method"
            fi
            
            # Show Redis info
            echo ""
            echo "Redis info:"
            redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" INFO SERVER 2>/dev/null | grep -E "redis_version|os|process_id" || echo "  (info unavailable)"
        else
            echo "❌ Redis is not running or not reachable at $REDIS_URL"
            echo ""
            echo "To start Redis, run: pnpm redis:start"
        fi
        ;;
    
    start)
        echo "=== Starting Redis ==="
        
        if is_redis_running; then
            echo "✅ Redis is already running"
            exit 0
        fi
        
        platform=$(detect_platform)
        started=false
        
        # Try native install first (brew on macOS, systemd on Linux)
        if [[ "$platform" == "macos" ]]; then
            if command -v brew &>/dev/null; then
                echo "Attempting to start via Homebrew..."
                if brew services list 2>/dev/null | grep -q redis; then
                    brew services start redis 2>/dev/null && started=true
                else
                    echo "  Redis not installed via Homebrew"
                    echo "  Install with: brew install redis"
                fi
            fi
        elif [[ "$platform" == "linux" ]]; then
            if command -v systemctl &>/dev/null; then
                echo "Attempting to start via systemd..."
                if systemctl list-unit-files | grep -q redis; then
                    sudo systemctl start redis 2>/dev/null && started=true || \
                    sudo systemctl start redis-server 2>/dev/null && started=true
                else
                    echo "  Redis not installed as systemd service"
                    echo "  Install with your package manager (e.g., apt install redis-server)"
                fi
            fi
        fi
        
        # Fallback to Docker if native methods failed
        if ! $started && command -v docker &>/dev/null; then
            echo "Attempting to start via Docker..."
            docker run -d --name echos-redis -p "${REDIS_PORT}:6379" redis:7-alpine &>/dev/null && started=true
        fi
        
        if $started; then
            # Wait for Redis to be ready
            echo "Waiting for Redis to be ready..."
            for i in {1..10}; do
                if is_redis_running; then
                    echo "✅ Redis started successfully"
                    echo ""
                    echo "Connection: $REDIS_URL"
                    echo "Verify with: pnpm redis:health"
                    exit 0
                fi
                sleep 1
            done
            echo "⚠️  Redis started but not responding yet. Check with: pnpm redis:status"
        else
            echo "❌ Failed to start Redis"
            echo ""
            echo "Please install Redis manually:"
            echo "  macOS:  brew install redis"
            echo "  Linux:  sudo apt install redis-server (or equivalent)"
            echo "  Docker: docker run -d -p ${REDIS_PORT}:6379 redis:7-alpine"
            exit 1
        fi
        ;;
    
    stop)
        echo "=== Stopping Redis ==="
        
        if ! is_redis_running; then
            echo "✅ Redis is not running"
            exit 0
        fi
        
        platform=$(detect_platform)
        stopped=false
        
        # Try to stop via the method it's running
        if [[ "$platform" == "macos" ]] && is_brew_redis_running; then
            echo "Stopping Homebrew Redis service..."
            brew services stop redis && stopped=true
        elif [[ "$platform" == "linux" ]] && is_systemd_redis_running; then
            echo "Stopping systemd Redis service..."
            sudo systemctl stop redis 2>/dev/null && stopped=true || \
            sudo systemctl stop redis-server 2>/dev/null && stopped=true
        elif is_docker_redis_running; then
            echo "Stopping Docker Redis container..."
            docker stop echos-redis &>/dev/null && docker rm echos-redis &>/dev/null && stopped=true
        fi
        
        if $stopped; then
            echo "✅ Redis stopped successfully"
        else
            echo "⚠️  Could not automatically stop Redis"
            echo "You may need to stop it manually"
            exit 1
        fi
        ;;
    
    health)
        echo "=== Redis Health Check ==="
        if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping &>/dev/null; then
            response=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping)
            echo "✅ $response"
            echo "Redis is healthy at $REDIS_URL"
            exit 0
        else
            echo "❌ Cannot connect to Redis at $REDIS_URL"
            echo ""
            echo "Run 'pnpm redis:start' to start Redis"
            exit 1
        fi
        ;;
    
    *)
        echo "Usage: $0 [status|start|stop|health]"
        echo ""
        echo "Commands:"
        echo "  status  - Show Redis status and connection info"
        echo "  start   - Start Redis (prefers native, falls back to Docker)"
        echo "  stop    - Stop Redis"
        echo "  health  - Check if Redis is accepting connections"
        echo ""
        echo "Note: Redis is required for EchOS"
        exit 1
        ;;
esac
