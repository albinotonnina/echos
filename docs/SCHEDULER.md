# Scheduler

Background job processing for digests, reminder notifications, and content processing.

## Overview

The scheduler uses BullMQ with Redis to run periodic jobs. It is **disabled by default** and opt-in via the `ENABLE_SCHEDULER=true` environment variable. When disabled, the app starts normally without requiring Redis.

## Prerequisites

- Redis instance running (default: `redis://localhost:6379`)
- `ENABLE_SCHEDULER=true` in your environment

## Configuration

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `ENABLE_SCHEDULER` | Enable background job processing | `false` | `true` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` | `redis://myhost:6379` |
| `DIGEST_SCHEDULE` | Cron for AI daily digest | (disabled) | `0 8 * * *` |
| `REMINDER_CHECK_SCHEDULE` | Cron for due reminder checks | (disabled) | `*/15 * * * *` |
| `NEWSLETTER_SCHEDULE` | Cron for newsletter scraping | (disabled) | Not yet implemented |
| `TRENDING_SCHEDULE` | Cron for trending monitor | (disabled) | Not yet implemented |

All schedule fields use standard cron expressions. Leave empty to disable a specific job.

## Jobs

### Daily Digest

Creates a temporary AI agent that reviews recent notes and upcoming reminders, then composes a summary and sends it via Telegram.

```
DIGEST_SCHEDULE=0 8 * * *    # Every day at 8:00 AM
```

**Note**: Each digest invocation makes Claude API calls. Set the schedule accordingly to manage costs.

### Reminder Check

Queries the SQLite database for pending reminders with a due date in the past. Due reminders are sorted by priority (high first) and sent as a notification.

```
REMINDER_CHECK_SCHEDULE=*/15 * * * *    # Every 15 minutes
```

**Important**: Once a reminder is shown in a "Reminder Check" notification, it is automatically marked as completed and will not appear in future checks. This prevents the same reminder from being shown repeatedly.

This job does not use AI and has no API cost.

### Content Processing

Processes article and YouTube URLs queued by the agent during conversations. This runs automatically when URLs are submitted; no cron schedule is needed.

## Architecture

```
src/index.ts
    │
    ├── NotificationService (from @echos/telegram or log-only fallback)
    │
    └── @echos/scheduler
         ├── Queue (BullMQ)
         ├── Job Scheduler (cron → queue)
         └── Worker
              └── Job Router
                   ├── digest     → DigestProcessor (creates AI agent)
                   ├── reminder   → ReminderProcessor (SQLite query)
                   └── content    → ContentProcessor (article/youtube)
```

The scheduler never imports `@echos/telegram` directly. Notification delivery is injected via the `NotificationService` interface defined in `@echos/shared`. When Telegram is disabled, notifications are logged instead of sent.

## Graceful Shutdown

On SIGINT/SIGTERM, the worker and queue are closed before interfaces and storage. In-progress jobs will complete before the worker shuts down.

## Example Setup

```bash
# .env
ENABLE_SCHEDULER=true
REDIS_URL=redis://localhost:6379
DIGEST_SCHEDULE=0 8 * * *
REMINDER_CHECK_SCHEDULE=*/15 * * * *
```

```bash
# Start Redis (if not using Docker)
redis-server

# Start EchOS
pnpm start
```

With Docker Compose, Redis is included automatically.
