# Interface Guide

EchOS supports three interfaces for interacting with your personal knowledge base. You can enable/disable each interface in your `.env` file.

## Configuration

Edit `.env` to control which interfaces are active:

```bash
# Enable/disable interfaces
ENABLE_TELEGRAM=true   # Telegram bot
ENABLE_WEB=true        # Web API server
ENABLE_TUI=false       # Terminal UI

# Web server port
WEB_PORT=3000
```

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

### Features

- ✅ Streaming responses (live updates as AI thinks)
- ✅ Multi-user support (each user has isolated sessions)
- ✅ Rate limiting per user
- ✅ Authentication via `ALLOWED_USER_IDS`
- ✅ Voice message support (with Whisper transcription)
- ✅ Photo/document support

### Security

Only users listed in `ALLOWED_USER_IDS` can interact with the bot. All requests are validated and sanitized.

---

## 2. Web API Interface

**Default**: Enabled

### Setup

Configure in `.env`:
```bash
ENABLE_WEB=true
WEB_PORT=3000
```

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

#### Send Chat Message

```bash
POST /api/chat
Content-Type: application/json

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

#### Reset Chat Session

```bash
POST /api/chat/reset
Content-Type: application/json

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
  -d '{
    "userId": 123,
    "message": "Create a note about quantum computing basics"
  }'
```

**Search knowledge:**
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 123,
    "message": "Find notes about machine learning"
  }'
```

**Save an article:**
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 123,
    "message": "Save this article: https://example.com/ai-trends"
  }'
```

**Health check:**
```bash
curl http://localhost:3000/health
```

### Features

- ✅ RESTful JSON API
- ✅ CORS enabled (for frontend integration)
- ✅ Session management per user
- ✅ Tool execution tracking
- ✅ Non-streaming responses (full response after completion)

### Integration

Build a frontend application that calls this API:

```javascript
async function chat(message) {
  const response = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: 123,
      message: message
    })
  });
  return await response.json();
}

// Usage
const result = await chat('What are my recent notes?');
console.log(result.response);
```

---

## 3. Terminal UI (TUI) Interface

**Default**: Disabled

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
| **Multi-user** | ✅ Yes | ✅ Yes | ❌ No |
| **Authentication** | ✅ User IDs | ⚠️ DIY | ❌ None |
| **Streaming** | ✅ Yes | ❌ No | ✅ Yes |
| **Mobile Access** | ✅ Yes | ✅ Yes | ❌ No |
| **Voice Input** | ✅ Yes | ❌ No | ❌ No |
| **Easy Setup** | ⚠️ Bot token | ✅ Simple | ✅ Instant |
| **Production Ready** | ✅ Yes | ⚠️ Needs auth | ❌ Dev only |
| **Best For** | Daily use | Integration | Testing |

**Recommendations:**

- **Primary use**: Telegram (most features, best UX)
- **Automation/integration**: Web API (build custom frontends)
- **Development/testing**: TUI (instant feedback, no setup)

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
- ⚠️ **No built-in authentication** - add your own!
- ⚠️ Exposed on `0.0.0.0` (all network interfaces)
- ✅ CORS enabled (configure as needed)
- 💡 **Production**: Deploy behind nginx with HTTPS + auth

### TUI
- ⚠️ **No authentication** - runs with system user permissions
- ✅ Local only (no network exposure)
- ✅ Safe for development/testing

**For production Web API deployment**, add authentication:

```typescript
// Example: API key middleware
app.addHook('preHandler', async (request, reply) => {
  const apiKey = request.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    reply.code(401).send({ error: 'Unauthorized' });
  }
});
```

---

## Quick Start Examples

### Test Web API
```bash
# Start web only
pnpm start:web-only

# In another terminal, test it:
curl http://localhost:3000/health

curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
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
