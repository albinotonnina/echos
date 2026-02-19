# Interface Guide

EchOS supports three interfaces for interacting with your personal knowledge base. You can enable/disable each interface in your `.env` file.

## Configuration

Edit `.env` to control which interfaces are active:

```bash
# Enable/disable interfaces
ENABLE_TELEGRAM=true   # Telegram bot (stable, recommended)
ENABLE_WEB=false       # Web API server (experimental, disabled by default)
ENABLE_TUI=false       # Terminal UI (experimental, disabled by default)

# Web server port (only used when ENABLE_WEB=true)
WEB_PORT=3000

# Web API authentication key — required when ENABLE_WEB=true
# Generate with: openssl rand -hex 32
WEB_API_KEY=your_secret_key_here
```

> **Note**: Web UI and TUI are experimental interfaces. Telegram is the recommended interface for daily use. The setup wizard (`pnpm wizard`) generates a `WEB_API_KEY` automatically when you enable the web interface.

**Start the application:**
```bash
pnpm start
```

The application will start all enabled interfaces simultaneously.

---

## 1. Telegram Bot Interface

**Default**: Enabled

### Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) on Telegram
2. Get your bot token
3. Get your Telegram user ID from [@userinfobot](https://t.me/userinfobot)
4. Configure in `.env`:
   ```bash
   TELEGRAM_BOT_TOKEN=your_token_here
   ALLOWED_USER_IDS=123456789,987654321
   ```

### Usage

1. Start EchOS: `pnpm start`
2. Open Telegram and message your bot
3. Send natural language commands:
   - `"Save this article: https://example.com/post"`
   - `"What notes do I have about TypeScript?"`
   - `"Create a note called 'Project Ideas'"`
   - `"Remind me to review the proposal tomorrow"`

### Commands

| Command | Description |
|---|---|
| `/start` | Welcome message |
| `/reset` | Clear conversation history and start fresh |
| `/usage` | Show token usage and cost for the current session |
| `/followup <message>` | Queue a message to run after the current task finishes |
| `/model [fast\|balanced\|deep]` | Show or switch the model for the current session |

### Steering (mid-run interruption)

If the agent is currently processing a task and you send a new text message, EchOS steers the agent rather than queuing a second turn:

1. The agent finishes its current tool call
2. Remaining tool calls in the turn are skipped
3. The new message is injected and the agent responds to it

The agent replies "↩️ Redirecting..." immediately to acknowledge receipt. The final response (for the original turn, now steered) is updated in the original message thread.

Use `/followup` instead when you want to *chain* work after the current task — e.g. "save this article" then `/followup summarise the key points`.

### Features

- ✅ Streaming responses (live updates as AI thinks)
- ✅ Multi-user support (each user has isolated sessions)
- ✅ Rate limiting per user
- ✅ Authentication via `ALLOWED_USER_IDS`
- ✅ Voice message support (with Whisper transcription)
- ✅ Photo/document support
- ✅ Mid-run steering and follow-up queuing

### Security

Only users listed in `ALLOWED_USER_IDS` can interact with the bot. All requests are validated and sanitized.

---

## 2. Web API Interface

**Default**: Disabled — **experimental**

### Setup

Configure in `.env`:
```bash
ENABLE_WEB=true
WEB_PORT=3000
WEB_API_KEY=your_secret_key_here   # required — protects all API routes
```

Generate a key:
```bash
openssl rand -hex 32
```

Or run `pnpm wizard` — it generates and stores the key automatically.

### Usage

Start EchOS and access the API at `http://localhost:3000`

### Endpoints

#### Health Check

```bash
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-02-15T23:45:00.000Z"
}
```

All API routes except `/health` require an `Authorization` header:

```
Authorization: Bearer <WEB_API_KEY>
```

The `userId` in every request must be one of the values in `ALLOWED_USER_IDS` — requests with unknown user IDs are rejected with `403`.

#### Send Chat Message

```bash
POST /api/chat
Content-Type: application/json
Authorization: Bearer <WEB_API_KEY>

{
  "userId": 123,
  "message": "What notes do I have?"
}
```

**Response:**
```json
{
  "response": "You have 15 notes covering topics like...",
  "toolCalls": [
    { "name": "list_notes", "result": "success" }
  ]
}
```

#### Steer Running Agent

Interrupt the agent mid-turn. Only valid while a `/api/chat` request is in flight for the same `userId`. Skips remaining tool calls and injects the new message.

```bash
POST /api/chat/steer
Content-Type: application/json
Authorization: Bearer <WEB_API_KEY>

{ "userId": 123, "message": "Actually focus on X instead" }
```

Returns `409` if the agent is not currently running.

#### Switch Model Preset

```bash
POST /api/chat/model
Content-Type: application/json
Authorization: Bearer <WEB_API_KEY>

{ "userId": 123, "preset": "balanced" }
```

Valid presets: `fast` | `balanced` | `deep`. Returns `{ ok: true, model: "<model-id>" }`.

#### Queue Follow-up

Queue a message to run after the current agent turn completes. Safe to call at any time — the message is held until the agent is idle.

```bash
POST /api/chat/followup
Content-Type: application/json
Authorization: Bearer <WEB_API_KEY>

{ "userId": 123, "message": "Now summarise what you just saved" }
```

#### Reset Chat Session

```bash
POST /api/chat/reset
Content-Type: application/json
Authorization: Bearer <WEB_API_KEY>

{
  "userId": 123
}
```

**Response:**
```json
{
  "ok": true
}
```

### Examples

**Create a note:**
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WEB_API_KEY" \
  -d '{"userId": 123, "message": "Create a note about quantum computing basics"}'
```

**Search knowledge:**
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WEB_API_KEY" \
  -d '{"userId": 123, "message": "Find notes about machine learning"}'
```

**Save an article:**
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WEB_API_KEY" \
  -d '{"userId": 123, "message": "Save this article: https://example.com/ai-trends"}'
```

**Health check (no auth required):**
```bash
curl http://localhost:3000/health
```

### Features

- ✅ RESTful JSON API
- ✅ Bearer token authentication (`WEB_API_KEY`)
- ✅ `userId` validated against `ALLOWED_USER_IDS`
- ✅ CORS restricted to localhost origins
- ✅ Server binds to `127.0.0.1` (not externally reachable)
- ✅ Session management per user
- ✅ Tool execution tracking
- ✅ Non-streaming responses (full response after completion)

### Integration

Build a frontend application that calls this API:

```javascript
const API_KEY = process.env.WEB_API_KEY; // load from env, never hardcode

async function chat(message, userId) {
  const response = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ userId, message }),
  });
  return await response.json();
}

// Usage
const result = await chat('What are my recent notes?', 123);
console.log(result.response);
```

---

## 3. Terminal UI (TUI) Interface

**Default**: Disabled — **experimental**

### Setup

Configure in `.env`:
```bash
ENABLE_TUI=true
```

### Usage

1. Start EchOS: `pnpm start`
2. The terminal will show an interactive prompt
3. Type your questions/commands
4. Press Enter to send
5. See streaming responses in real-time
6. Type `exit` or `quit` to close

### Example Session

```
EchOS Terminal (type "exit" to quit)

> What notes do I have about TypeScript?

[search_knowledge] 
I found 3 notes about TypeScript:

1. "TypeScript Best Practices" (created 2026-02-10)
   - Covers strict mode, type inference, and utility types
   
2. "Setting up TypeScript in Node.js" (created 2026-02-08)
   - Guide for configuring tsconfig.json
   
3. "TypeScript vs JavaScript" (created 2026-01-15)
   - Comparison and when to use each

> Create a note about React hooks

[create_note] 
Created note "React Hooks Overview"

I've created a note about React hooks. Would you like me to add specific 
information about useState, useEffect, or other hooks?

> exit
```

### Features

- ✅ Interactive readline-based interface
- ✅ Streaming responses (see AI "think" in real-time)
- ✅ Tool execution visibility
- ✅ Simple text-only interface
- ✅ Runs in current terminal session

### Use Cases

- **Quick Testing**: Test agent behavior without Telegram
- **Development**: Debug tools and agent responses
- **Local Use**: Access your knowledge base from the command line
- **Scripting**: Can be integrated with shell scripts (stdin/stdout)

### Limitations

- Single user session (no multi-user support)
- No authentication (runs with local user permissions)
- No file upload support
- Text-only (no images, voice, etc.)

---

## Choosing the Right Interface

| Feature | Telegram | Web API | TUI |
|---------|----------|---------|-----|
| **Status** | ✅ Stable | ⚠️ Experimental | ⚠️ Experimental |
| **Default** | On | Off | Off |
| **Multi-user** | ✅ Yes | ✅ Yes | ❌ No |
| **Authentication** | ✅ User IDs | ✅ API key + user IDs | ❌ Local only |
| **Network exposure** | Telegram servers | localhost only | None |
| **Streaming** | ✅ Yes | ❌ No | ✅ Yes |
| **Mobile Access** | ✅ Yes | ✅ Yes (localhost) | ❌ No |
| **Voice Input** | ✅ Yes | ❌ No | ❌ No |
| **Best For** | Daily use | Local integration | Dev/testing |

**Recommendations:**

- **Primary use**: Telegram (most features, best UX, stable)
- **Local automation/integration**: Web API (requires `WEB_API_KEY`)
- **Development/testing**: TUI (instant feedback, no network)

---

## Multiple Interfaces

You can run **all interfaces simultaneously**:

```bash
# .env
ENABLE_TELEGRAM=true
ENABLE_WEB=true
ENABLE_TUI=true
```

This allows you to:
- Message the bot on Telegram while traveling
- Query via API from a custom dashboard
- Test commands in the terminal during development

**Note**: Each interface maintains its own session state, so conversations don't carry across interfaces unless you implement shared session storage.

---

## Security Considerations

### Telegram
- ✅ Built-in authentication via `ALLOWED_USER_IDS`
- ✅ Rate limiting per user
- ✅ Input validation and sanitization
- ⚠️ Only one instance can run per bot token

### Web API
- ✅ Bearer token auth via `WEB_API_KEY` (set in `.env`)
- ✅ `userId` validated against `ALLOWED_USER_IDS` on every request
- ✅ Binds to `127.0.0.1` — not reachable from the network
- ✅ CORS restricted to `localhost` / `127.0.0.1` origins
- ⚠️ Experimental — not recommended as the primary interface
- ⚠️ If `WEB_API_KEY` is missing, the server starts but logs a warning and all routes are unauthenticated

### TUI
- ⚠️ **No authentication** — runs with local user permissions
- ✅ No network exposure (stdin/stdout only)
- ✅ Safe for development/testing
- ⚠️ Experimental

---

## Quick Start Examples

### Test Web API
```bash
# Start web only
pnpm start:web-only

# In another terminal, test it:
curl http://localhost:3000/health   # no auth required

# Load key from .env
export WEB_API_KEY=$(grep ^WEB_API_KEY .env | cut -d= -f2)

curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WEB_API_KEY" \
  -d '{"userId": 123, "message": "Hello!"}'
```

### Test Terminal UI
```bash
# Start TUI only
pnpm start:tui-only

# You'll see:
# EchOS Terminal (type "exit" to quit)
# 
# > 

# Type: list my notes
# Type: exit (when done)
```

### Test All Interfaces
```bash
# Configure .env
ENABLE_TELEGRAM=true
ENABLE_WEB=true
ENABLE_TUI=false  # Can't use with Telegram/Web in same terminal

# Start all
pnpm start

# Access:
# - Telegram: Message your bot
# - Web: curl http://localhost:3000/health
```

---

## Troubleshooting

### Telegram: 409 Conflict Error
See [TROUBLESHOOTING.md#telegram-bot-conflicts](./TROUBLESHOOTING.md#telegram-bot-conflicts)

### Web API: Port Already in Use
```bash
# Change port in .env
WEB_PORT=3001

# Or find and kill the process using port 3000
lsof -ti:3000 | xargs kill
```

### TUI: Not Seeing Prompt
- Ensure `ENABLE_TUI=true` in `.env`
- Check logs for errors: `pnpm start 2>&1 | tee echos.log`
- Only one TUI can run per terminal session

### Interface Not Starting
Check the startup logs:
```bash
pnpm start | pnpm exec pino-pretty
```

Look for messages like:
- `Telegram bot started`
- `Web server started` (with port number)
- `TUI started`

---

## Next Steps

- **Telegram**: See examples in the [main README](../README.md)
- **Web API**: Build a frontend with React/Vue/etc.
- **TUI**: Use for quick local queries and testing
- **Deploy**: See [DEPLOYMENT.md](./DEPLOYMENT.md) for production setup
