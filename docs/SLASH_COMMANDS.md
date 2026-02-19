# Slash Commands

This document lists all slash commands supported by the EchOS agent across different interfaces.

## Telegram Bot Commands

The Telegram interface supports the following slash commands:

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and help - displays information about the bot's capabilities |
| `/reset` | Clears the current agent session and starts fresh |
| `/usage` | Shows current session usage statistics including message count, tokens, and cost |

### /start

Displays a welcome message with information about what you can do with EchOS:

```
Welcome to EchOS! I'm your personal knowledge assistant.

Just send me a message and I'll help you manage your knowledge base.

You can:
- Send text to create notes
- Send URLs to save articles
- Ask questions about your knowledge
- Send voice messages to transcribe and process them
- Manage reminders and more
```

### /reset

Clears your current agent session. This is useful when you want to start a fresh conversation without any context from previous messages.

**Response:** `Session cleared. Starting fresh.`

### /usage

Displays detailed usage statistics for your current session:

- **Messages**: Number of messages exchanged
- **Input tokens**: Total input tokens used
- **Output tokens**: Total output tokens generated
- **Cache read**: Tokens read from cache
- **Cache write**: Tokens written to cache
- **Cost**: Estimated cost in USD
- **Context window**: Percentage of context window used

## TUI Commands

The Terminal User Interface (TUI) does not support slash commands but has the following built-in commands:

| Command | Description |
|---------|-------------|
| `exit` | Exit the TUI session |
| `quit` | Exit the TUI session |

These commands are case-insensitive and can be typed at the prompt to terminate the session.

## Agent Tools

While not slash commands, the agent has access to the following tools that can be invoked through natural language:

### Core Tools

| Tool | Description |
|------|-------------|
| `create_note` | Create new notes, journal entries, or save text |
| `get_note` | Retrieve a specific note by ID |
| `list_notes` | Browse notes by type or category |
| `update_note` | Modify existing notes |
| `delete_note` | Remove notes (confirms with user first) |
| `search_knowledge` | Search across the knowledge base |
| `categorize_note` | Automatically categorize existing notes |
| `link_notes` | Create connections between related notes |

### Reminders

| Tool | Description |
|------|-------------|
| `add_reminder` | Set a reminder for a task |
| `complete_reminder` | Mark a reminder as complete |

### Memory

| Tool | Description |
|------|-------------|
| `remember_about_me` | Store facts and preferences about the user |
| `recall_knowledge` | Recall previously stored information |

### Plugins

The following tools are available through plugins:

#### Article Plugin
- `save_article` - Fetch, extract, and save web articles with optional AI categorization

#### YouTube Plugin
- `save_youtube` - Save and process YouTube videos with optional AI categorization

#### Content Creation Plugin
- `analyze_my_style` - Analyze writing style from notes tagged `voice-example`
- `create_content` - Generate new content based on style profile
- `get_style_profile` - Retrieve saved style profiles
- `mark_as_voice_example` - Tag a note as a voice/style example
