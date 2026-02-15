#!/usr/bin/env bash
#
# Check and manage Telegram bot status
# Usage: ./scripts/check-telegram-bot.sh [command]
# Commands: status, delete-webhook, set-polling

set -euo pipefail

# Load .env file
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
    echo "Error: TELEGRAM_BOT_TOKEN not set in .env"
    exit 1
fi

BASE_URL="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}"

command="${1:-status}"

case "$command" in
    status)
        echo "=== Bot Info ==="
        curl -s "${BASE_URL}/getMe" | jq .
        echo ""
        echo "=== Webhook Info ==="
        curl -s "${BASE_URL}/getWebhookInfo" | jq .
        ;;
    
    delete-webhook)
        echo "Deleting webhook..."
        result=$(curl -s "${BASE_URL}/deleteWebhook?drop_pending_updates=true")
        echo "$result" | jq .
        if echo "$result" | jq -e '.ok' > /dev/null; then
            echo "✅ Webhook deleted successfully. You can now use polling."
        else
            echo "❌ Failed to delete webhook"
            exit 1
        fi
        ;;
    
    set-polling)
        echo "Switching to polling mode (deleting any webhook)..."
        result=$(curl -s "${BASE_URL}/deleteWebhook?drop_pending_updates=true")
        echo "$result" | jq .
        if echo "$result" | jq -e '.ok' > /dev/null; then
            echo "✅ Bot ready for polling mode."
            echo "You can now start with: pnpm start"
        else
            echo "❌ Failed to configure polling"
            exit 1
        fi
        ;;
    
    *)
        echo "Usage: $0 [status|delete-webhook|set-polling]"
        echo ""
        echo "Commands:"
        echo "  status          - Show bot info and webhook status"
        echo "  delete-webhook  - Remove webhook (allows polling)"
        echo "  set-polling     - Configure bot for polling mode"
        exit 1
        ;;
esac
