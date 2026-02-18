# Architecture Decisions

## Technology Choices

### Core Framework: pi-mono packages

**Decision**: Build on pi-mono's agent infrastructure rather than from scratch

**Rationale**:
- Proven multi-provider LLM abstraction (Anthropic, OpenAI, Google, xAI)
- Agent runtime with tool calling already implemented
- Streaming support built-in
- Cross-provider context handoffs
- Active development and community

**Packages used**:
```json
{
  "@mariozechner/pi-ai": "^0.52.x",
  "@mariozechner/pi-agent-core": "^0.52.x",
  "@mariozechner/pi-web-ui": "^0.52.x",
  "@mariozechner/pi-tui": "^0.52.x"
}
```

### Storage: Markdown + SQLite + Vectors

**Markdown for primary storage**:
- Human-readable, future-proof
- Git-friendly for versioning
- Tooling ecosystem (editors, converters)
- No vendor lock-in

**SQLite for indexing**:
```sql
-- Full-text search
CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, content, tags, 
  content=notes, content_rowid=id
);

-- Metadata index
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  filepath TEXT NOT NULL,
  type TEXT NOT NULL, -- 'note', 'journal', 'article', 'youtube'
  title TEXT,
  created_at DATETIME,
  updated_at DATETIME,
  tags TEXT, -- JSON array
  links TEXT  -- JSON array of linked note IDs
);

CREATE INDEX idx_notes_type ON notes(type);
CREATE INDEX idx_notes_created ON notes(created_at);
CREATE INDEX idx_notes_tags ON notes(tags);
```

**Vector DB for semantic search**:
- **Option 1: ChromaDB** - Simple, Python-friendly, persistent
- **Option 2: LanceDB** - Rust-based, faster, TypeScript support
- **Decision**: LanceDB for TypeScript integration

```typescript
// Embedding strategy
- Use text-embedding-3-small (OpenAI) or similar
- 1536 dimensions
- Embed: title + first 500 words
- Re-embed on note update
- Batch embeddings for efficiency
```

### Markdown Frontmatter Schema

```yaml
---
id: uuid-v4
type: note|journal|article|youtube|reminder
title: string
created: ISO-8601
updated: ISO-8601
tags: [array, of, strings]
links: [note-id-1, note-id-2]  # Linked notes
source_url: string (for articles/youtube)
author: string (for articles)
completed: boolean (for reminders)
due_date: ISO-8601 (for reminders)
priority: low|medium|high (for reminders)
---

# Content starts here
```

## Agent Architecture

### Tool Design Philosophy

**Principle**: Each tool does ONE thing well
- Composable by agent
- Easy to test
- Clear responsibilities
- Plugin-friendly

### Core Tool Set

```typescript
// Read operations (no side effects)
- search_knowledge: Full-text + semantic search
- get_note: Retrieve specific note by ID
- list_notes: List notes with filters
- get_reminders: Get active/completed reminders
- show_links: Show note connections

// Write operations (state changes)
- create_note: New note with frontmatter
- update_note: Modify existing note
- delete_note: Remove note (with confirmation)
- add_reminder: Create reminder/todo
- complete_reminder: Mark reminder done
- link_notes: Create bidirectional link

// Content operations
- save_article: Fetch + parse web article
- save_youtube: Download transcript
- summarize_note: Generate summary
- extract_topics: Identify key topics

// Utility operations
- get_context: Get recent conversation context
- timestamp: Current time in user's timezone
```

### Tool Implementation Pattern

```typescript
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-agent-core";

export const createNoteTool: ToolDefinition = {
  name: "create_note",
  description: "Create a new note in the knowledge base",
  
  parameters: Type.Object({
    title: Type.String({ 
      description: "Note title" 
    }),
    content: Type.String({ 
      description: "Note content in markdown" 
    }),
    type: Type.Union([
      Type.Literal("note"),
      Type.Literal("journal"),
      Type.Literal("idea"),
      Type.Literal("technical"),
    ], {
      description: "Type of note"
    }),
    tags: Type.Optional(Type.Array(Type.String(), {
      description: "Tags for organization"
    })),
    links: Type.Optional(Type.Array(Type.String(), {
      description: "IDs of related notes"
    })),
  }),
  
  async execute({ title, content, type, tags = [], links = [] }, context) {
    // 1. Generate unique ID
    const id = generateUUID();
    
    // 2. Determine file path
    const filepath = determineFilepath(type, title, id);
    
    // 3. Create frontmatter
    const frontmatter = {
      id,
      type,
      title,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      tags,
      links,
    };
    
    // 4. Combine frontmatter + content
    const markdown = formatMarkdown(frontmatter, content);
    
    // 5. Write file
    await fs.writeFile(filepath, markdown, 'utf-8');
    
    // 6. Update search index
    await updateSearchIndex(id, frontmatter, content);
    
    // 7. Generate embedding
    await generateEmbedding(id, title, content);
    
    // 8. Update bidirectional links
    if (links.length > 0) {
      await updateBacklinks(id, links);
    }
    
    // 9. Return success
    return {
      content: [{
        type: "text",
        text: `Created note: ${title}\nPath: ${filepath}\nID: ${id}`
      }]
    };
  }
};
```

## Interface Implementations

### Telegram Bot

```typescript
// Architecture: Stateless bot → Agent session per user

import TelegramBot from 'node-telegram-bot-api';
import { createAgentSession } from '@mariozechner/pi-coding-agent';

class TelegramInterface {
  private bot: TelegramBot;
  private sessions: Map<number, AgentSession>;
  
  async handleMessage(msg: TelegramBot.Message) {
    const chatId = msg.chat.id;
    const session = await this.getOrCreateSession(chatId);
    
    // Handle different message types
    if (msg.text) {
      await this.handleTextMessage(session, msg, chatId);
    } else if (msg.voice) {
      await this.handleVoiceMessage(session, msg, chatId);
    } else if (msg.photo) {
      await this.handlePhotoMessage(session, msg, chatId);
    } else if (msg.document) {
      await this.handleDocumentMessage(session, msg, chatId);
    }
  }
  
  async handleTextMessage(session, msg, chatId) {
    // Extract URLs if present
    const urls = extractUrls(msg.text);
    
    // Check for YouTube links
    const youtubeUrls = urls.filter(isYouTubeUrl);
    
    // Stream response back to Telegram
    let currentMessageId: number | null = null;
    let currentText = "";
    
    const response = await session.prompt(msg.text, {
      attachments: urls.map(url => ({ type: 'url', url })),
      
      onChunk: async (chunk: string) => {
        currentText += chunk;
        
        // Only update every 500ms to avoid rate limits
        if (!currentMessageId) {
          const sent = await this.bot.sendMessage(chatId, currentText);
          currentMessageId = sent.message_id;
        } else {
          // Debounced update
          await this.debouncedUpdate(chatId, currentMessageId, currentText);
        }
      },
      
      onToolCall: async (tool: ToolCall) => {
        // Show typing indicator
        await this.bot.sendChatAction(chatId, 'typing');
        
        // Optionally send tool execution status
        if (tool.name === 'save_article' || tool.name === 'save_youtube') {
          await this.bot.sendMessage(chatId, `⏳ ${tool.name}...`);
        }
      },
    });
  }
  
  async getOrCreateSession(chatId: number): Promise<AgentSession> {
    if (!this.sessions.has(chatId)) {
      const session = await createAgentSession({
        sessionManager: SessionManager.persistent(
          `./data/sessions/telegram_${chatId}`
        ),
        authStorage: new AuthStorage(),
        modelRegistry: new ModelRegistry(),
        // Register all tools
        tools: getAllTools(),
      });
      
      this.sessions.set(chatId, session);
    }
    
    return this.sessions.get(chatId)!;
  }
}
```

### Web UI

```typescript
// React app with pi-web-ui components

import { ChatInterface } from '@mariozechner/pi-web-ui';
import { createAgentSession } from '@mariozechner/pi-coding-agent';

function KnowledgeChat() {
  const [session, setSession] = useState<AgentSession | null>(null);
  
  useEffect(() => {
    // Initialize agent session
    const initSession = async () => {
      const s = await createAgentSession({
        sessionManager: SessionManager.persistent('./data/sessions/web'),
        authStorage: new AuthStorage(),
        modelRegistry: new ModelRegistry(),
        tools: getAllTools(),
      });
      setSession(s);
    };
    
    initSession();
  }, []);
  
  if (!session) return <div>Loading...</div>;
  
  return (
    <div className="app">
      <Sidebar>
        <RecentNotes />
        <TagCloud />
        <SearchBox />
      </Sidebar>
      
      <ChatInterface
        session={session}
        streaming={true}
        renderToolCall={customToolRenderer}
        renderToolResult={customResultRenderer}
      />
      
      <KnowledgeGraph /> {/* Plugin component */}
    </div>
  );
}
```

### TUI

```typescript
import { TUI } from '@mariozechner/pi-tui';

class KnowledgeTUI {
  private tui: TUI;
  private session: AgentSession;
  
  async start() {
    this.tui = new TUI();
    
    // Layout: chat + sidebar
    this.tui.layout({
      type: 'split',
      direction: 'horizontal',
      splits: [
        { id: 'chat', weight: 0.7 },
        { id: 'sidebar', weight: 0.3 },
      ]
    });
    
    // Register keyboard shortcuts
    this.tui.onKey('ctrl+s', () => this.quickSearch());
    this.tui.onKey('ctrl+n', () => this.quickNote());
    this.tui.onKey('ctrl+r', () => this.showReminders());
    
    // Start agent loop
    await this.agentLoop();
  }
  
  async quickSearch() {
    const query = await this.tui.prompt('Search: ');
    const results = await searchKnowledge(query);
    this.tui.render('sidebar', formatSearchResults(results));
  }
}
```

## Plugin System

### Plugin Interface

```typescript
export interface KnowledgePlugin {
  name: string;
  version: string;
  description: string;
  
  // Lifecycle hooks
  onInit?(context: PluginContext): Promise<void>;
  onShutdown?(): Promise<void>;
  
  // Tool registration
  tools?: ToolDefinition[];
  
  // Event hooks
  onNoteCreated?(note: Note): Promise<void>;
  onNoteUpdated?(note: Note, oldNote: Note): Promise<void>;
  onNoteDeleted?(note: Note): Promise<void>;
  onSearch?(query: string): Promise<SearchResult[]>;
  
  // Content processing
  processMarkdown?(content: string, note: Note): Promise<string>;
  extractMetadata?(content: string): Promise<Record<string, any>>;
  
  // UI extensions
  webComponents?: React.ComponentType[];
  tuiWidgets?: TUIWidget[];
  telegramCommands?: TelegramCommand[];
}

export interface PluginContext {
  // Access to core services
  storage: StorageService;
  search: SearchService;
  agent: AgentService;
  
  // Utility functions
  log: Logger;
  config: ConfigService;
  
  // Register additional hooks
  registerHook(event: string, handler: Function): void;
}
```

### Example Plugin: Obsidian Compatibility

```typescript
export const ObsidianPlugin: KnowledgePlugin = {
  name: "obsidian-compat",
  version: "1.0.0",
  description: "Obsidian-style wikilinks and formatting",
  
  processMarkdown(content: string, note: Note): string {
    // Convert [[wikilinks]] to internal links
    return content.replace(/\[\[([^\]]+)\]\]/g, (match, title) => {
      const linkedNote = findNoteByTitle(title);
      if (linkedNote) {
        return `[${title}](note://${linkedNote.id})`;
      }
      return match;
    });
  },
  
  tools: [{
    name: "create_daily_note",
    description: "Create or open today's daily note",
    parameters: Type.Object({}),
    async execute() {
      const today = new Date().toISOString().split('T')[0];
      const existingNote = await findNote({ type: 'journal', date: today });
      
      if (existingNote) {
        return { content: [{ type: "text", text: `Opened: ${existingNote.title}` }] };
      } else {
        await createNote({
          title: `Daily Note - ${today}`,
          type: 'journal',
          content: `# ${today}\n\n## Tasks\n- [ ] \n\n## Notes\n\n`,
        });
        return { content: [{ type: "text", text: `Created daily note for ${today}` }] };
      }
    }
  }],
};
```

## Deployment Architecture

### Docker Setup

```yaml
# docker-compose.yml
version: '3.8'

services:
  agent:
    build: .
    volumes:
      - ./data/knowledge:/app/knowledge
      - ./data/sessions:/app/sessions
      - ./data/db:/app/db
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - NODE_ENV=production
    restart: unless-stopped
    networks:
      - knowledge-net
    
  web:
    build:
      context: .
      dockerfile: Dockerfile.web
    ports:
      - "3000:3000"
    depends_on:
      - agent
    networks:
      - knowledge-net
    restart: unless-stopped

networks:
  knowledge-net:
    driver: bridge

volumes:
  knowledge-data:
  session-data:
  db-data:
```

### Environment Configuration

```bash
# .env.example
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx  # Optional, for embeddings
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_WEBHOOK_URL=https://yourdomain.com/webhook  # Optional

# Storage paths
KNOWLEDGE_DIR=./data/knowledge
SESSION_DIR=./data/sessions
DB_PATH=./data/db/knowledge.db

# LLM settings
DEFAULT_MODEL=claude-3-5-haiku-20241022
EMBEDDING_MODEL=text-embedding-3-small

# Features
ENABLE_WEB_UI=true
ENABLE_TUI=true
ENABLE_TELEGRAM=true

# Security
ALLOWED_USERS=telegram_user_id_1,telegram_user_id_2  # Optional whitelist
```

## Security Considerations

### Data Privacy
- All data stored locally by default
- Optional E2E encryption for cloud sync
- User control over LLM provider (can use local models)

### Access Control
- Telegram: User ID whitelist
- Web: JWT authentication
- TUI: Local access only (SSH requires auth)

### API Key Management
- Never stored in markdown files
- Environment variables or secure vault
- Rotation support

## Performance Targets

- **Search latency**: < 100ms for SQLite FTS, < 500ms for semantic
- **Agent response**: First token < 1s, complete response < 5s
- **Embedding generation**: Batch process, async
- **Telegram message**: < 2s for simple queries
- **File operations**: Non-blocking, async

## Testing Strategy

```typescript
// Unit tests: Individual tools
describe('create_note tool', () => {
  it('should create note with correct frontmatter', async () => {
    const result = await createNoteTool.execute({
      title: 'Test Note',
      content: 'Test content',
      type: 'note',
    });
    
    expect(result.success).toBe(true);
    expect(fs.existsSync(result.filepath)).toBe(true);
  });
});

// Integration tests: Agent workflows
describe('agent workflows', () => {
  it('should save article and create note about it', async () => {
    const response = await agent.prompt(
      'Save this article and create a summary note: https://example.com/article'
    );
    
    expect(response).toContain('Saved article');
    expect(response).toContain('Created note');
  });
});

// E2E tests: Full interface flows
describe('telegram bot', () => {
  it('should handle article save request', async () => {
    const response = await sendTelegramMessage(
      '/save https://example.com/article'
    );
    
    expect(response).toContain('Saved');
  });
});
```

## Monitoring & Observability

```typescript
// Metrics to track
- Agent response times
- Tool execution counts
- Search query performance
- Error rates by tool
- Token usage / costs
- User activity patterns

// Logging strategy
- Structured logs (JSON)
- Log levels: DEBUG, INFO, WARN, ERROR
- Separate logs for agent decisions vs tool execution
- PII filtering (don't log note content in production)
```

## Future Considerations

- **Sync**: CouchDB/PouchDB for multi-device sync
- **Mobile app**: React Native wrapper around web UI
- **Voice input**: Whisper integration for voice notes
- **OCR**: Extract text from images
- **Multi-user**: Team knowledge bases with permissions
- **Export**: Obsidian, Notion, Roam export formats
- **Import**: Bulk import from other tools
- **Analytics**: Personal insights from knowledge graph
