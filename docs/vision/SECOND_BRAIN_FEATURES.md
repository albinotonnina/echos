# Second Brain Features

## What Makes a True Second Brain?

A second brain isn't just storage — it's an **extension of your cognition** that:
- Remembers perfectly what you forget
- Surfaces insights you'd miss
- Connects ideas across time and context
- Helps you think better, create more, learn faster
- Grows smarter as you use it
- Absorbs knowledge from wherever it already lives
- Works across text, images, audio, and documents

---

## Core Second Brain Capabilities

### 1. Perfect Memory & Recall

**What:** Never forget anything you've told it or learned

**Status:** Core implemented, multi-media and import planned

**Features:**
- **Conversation Memory** — Remembers every interaction
- **Factual Memory** — Stores facts about you, your work, your relationships (5 kinds: fact, person, project, expertise, preference)
- **Contextual Recall** — Retrieves relevant info when you need it
- **Timeline Memory** — "What was I thinking about in March?"
- **Associative Memory** — Remembers connections between topics
- **Multi-media Memory** — Images, PDFs, audio become searchable text (see [Section 17](#17-multi-media-intelligence))
- **Imported Memory** — Knowledge from Obsidian, Notion, Apple Notes, Google (see [Section 16](#16-data-import--migration))

**Implemented Tools:**
- `remember_about_me(kind, content, context?)` — Store personal facts with confidence scoring
- `recall_knowledge(topic)` — Retrieve memories by topic search
- `search_knowledge(query, type?, limit?)` — Hybrid keyword + semantic search
- `get_note(id)` — Retrieve specific note with full metadata
- `list_notes(type?, category?, tags?, limit?, offset?)` — Browse with filtering

**Examples:**
```
You: "What did I tell you about the API redesign with Sarah?"
→ Recalls specific notes, context, decisions made

You: "When did I first start learning Rust?"
→ Shows first mention, charts learning journey

You: "What was I worried about last month?"
→ Analyzes journal entries, surfaces themes
```

---

### 2. Automatic Organization & Tagging

**What:** Organizes information without manual filing

**Status:** Core implemented via `categorize_note`

**Features:**
- **Auto-tagging** — AI analyzes content, applies relevant tags
- **Topic Clustering** — Groups related notes automatically
- **Smart Folders** — Virtual folders based on topics, not hierarchy (Markdown stored by category directory)
- **Relationship Detection** — Links related notes via `link_notes`
- **Duplicate Detection** — Content hashing (SHA-256) catches identical content
- **Bulk Import Categorization** — Auto-categorize during data import (planned)

**Implemented Tools:**
- `categorize_note(id, mode?)` — AI categorization in `lightweight` (category + tags) or `full` (+ summary, gist, key points) mode
- `link_notes(source_id, target_id)` — Create bidirectional links

**Examples:**
```
You create note about "async Rust in web servers"
→ Auto-tagged: #rust #async #webdev #backend
→ Auto-linked to: previous Rust notes, web architecture notes

You import 500 notes from Obsidian
→ Reconciler syncs all files
→ Bulk categorization job processes each through categorize_note
→ Deduplication catches any content already in the system
```

---

### 3. Proactive Intelligence

**What:** Anticipates needs, surfaces relevant info, adapts its engagement level to context

**Status:** Basic digest implemented, full proactive system planned (Phase 3 — top priority)

#### The Interaction Model

EchOS has three engagement modes:

**Reactive Mode (Default)**
The agent responds when asked. This is the baseline — you ask questions, save notes, search knowledge. No unsolicited suggestions. Most interactions are reactive.

**Focus Session Mode (User-Activated)**
You tell the agent you're focusing on a topic. It becomes proactive within that scope:
- Surfaces related notes as you work ("This connects to your note on...")
- Detects patterns ("You've written about X from 3 angles — missing the performance aspect")
- Suggests knowledge gaps ("You have notes on Rust async but nothing on error handling in async")
- Tracks what you create during the session for end-of-session synthesis

See [Section 18: Focus Sessions](#18-focus-sessions) for full details.

**Pattern-Triggered Proactive**
Even outside focus sessions, certain triggers activate proactive behavior:
- **Accumulation trigger**: 3+ articles/notes on the same topic within a week → "You've been researching distributed tracing. Want me to create a summary?"
- **Contradiction trigger**: New note conflicts with existing knowledge → "This contradicts your earlier note about X. Want to reconcile?"
- **Repetition trigger**: Asking about the same topic 3+ times → "You keep coming back to this. Want me to create a dedicated knowledge note?"
- **Deadline trigger**: Approaching due dates on reminders → escalating notification urgency
- **Milestone trigger**: Reaching a knowledge threshold → "You now have 20+ notes on Rust — enough for a blog post or talk"

#### Notification Routing

Proactive insights need the right delivery channel at the right time:

| Priority | Channel | When | Example |
|----------|---------|------|---------|
| **Urgent** | Telegram push (immediate) | Time-sensitive, blocking | "Reminder due in 1 hour: API review meeting" |
| **Important** | Telegram at check-in time | Actionable, not urgent | "Weekly review ready: 3 patterns detected" |
| **Low priority** | Daily/weekly email digest | Informational, batched | "5 new connections found between your notes" |
| **Ambient** | In-app on next interaction | Context-enriching | "Related to what you're reading: your note from March" |

The notification service (already scaffolded in the scheduler) routes messages based on priority and user preferences.

**Planned Tools:**
- `daily_review()` — Suggest what to review today
- `weekly_synthesis()` — Create weekly summary with patterns
- `spot_patterns(time_range)` — Detect recurring themes
- `suggest_next_actions(project)` — Recommend next steps
- `find_contradictions(topic)` — Surface conflicting information
- `resurface_old_gem()` — Spaced repetition for forgotten notes

**Examples:**
```
Monday morning (automatic digest):
→ "Based on your calendar, you have investor meeting Wednesday.
   Here are relevant notes: Q3 metrics, last investor update,
   Sarah's concerns about burn rate."

After saving 3 articles on a topic:
→ "You've been researching distributed tracing. Want me to
   create a summary note with key insights?"

During focus session on "API performance":
→ "Your note about database connection pooling from last month
   is directly relevant. Also found: 2 saved articles about
   caching strategies you haven't connected yet."

Friday afternoon:
→ "Weekly review ready: 12 notes created, 3 projects advanced,
   recurring theme: performance optimization. Create summary?"
```

---

### 4. Knowledge Graph & Connections

**What:** Builds network of your ideas, shows relationships

**Status:** Bidirectional linking implemented (`link_notes`), graph visualization planned

**Features:**
- **Bidirectional Links** — Notes link to each other via `link_notes`
- **Graph Visualization** — See your knowledge network (planned — Web UI)
- **Path Finding** — "How is X related to Y?"
- **Cluster Detection** — Identifies knowledge domains
- **Weak Link Detection** — "These should be connected"

**Examples:**
```
You: "Show me how my Rust learning connects to my web projects"
→ Graph showing: Rust notes → async patterns → API performance
                 → current web project

You create note about caching
→ "This is related to your database optimization notes and
   your API performance work. Link them?"
```

---

### 5. Intelligent Search

**What:** Find anything instantly, by meaning not just words

**Status:** Implemented — hybrid search (FTS5 + LanceDB vectors)

**Features:**
- **Semantic Search** — Find by concept via LanceDB vector similarity
- **Keyword Search** — Full-text search via SQLite FTS5
- **Hybrid Search** — Combines both for best results (default in `search_knowledge`)
- **Filtered Search** — By content type, category, tags, date range
- **Conversational Search** — Ask questions naturally, agent uses search tools

**Implemented Tools:**
- `search_knowledge(query, type?, limit?)` — Hybrid keyword + semantic search

**Examples:**
```
You: "Find notes about improving performance but not database stuff"
→ Returns notes about caching, async, profiling
→ Excludes database indexing notes

You: "What did I learn about error handling?"
→ Synthesizes answer from multiple notes
```

---

### 6. Learning Enhancement

**What:** Helps you actually learn, not just save

**Status:** Planned (Phase 4)

**Features:**
- **Spaced Repetition** — Reviews notes at optimal intervals
- **Active Recall** — Quizzes you on what you've learned
- **Learning Paths** — Suggests what to learn next
- **Mastery Tracking** — Tracks your understanding over time

Connected to the Learning Review workflow in [CONTENT_CREATION.md](./CONTENT_CREATION.md#learning-review).

---

### 7. Creative Amplification

**What:** Enhances your creative process

**Status:** Content generation implemented, idea generation planned

**Features:**
- **Idea Generation** — Suggests content ideas from your notes
- **Combination** — Connects disparate ideas
- **Elaboration** — Expands on brief notes
- **Reformatting** — Transforms notes to different formats

Content generation details in [CONTENT_CREATION.md](./CONTENT_CREATION.md).

---

### 8. Personal Analytics & Insights

**What:** Reveals patterns in your thinking and behavior

**Status:** Planned (Phase 4)

**Features:**
- **Thought Patterns** — What you think about most
- **Learning Velocity** — How fast you're learning topics
- **Knowledge Gaps** — What you don't know
- **Idea Evolution** — How your thinking changed over time
- **Energy Patterns** — When you're most productive (inferred from writing activity)

---

### 9. Goal & Project Tracking

**What:** Keeps you aligned with what matters

**Status:** Basic reminders implemented, full project tracking planned

**Implemented Tools:**
- `add_reminder(title, content?, due_date?, priority?)` — Create reminders with optional due date and priority (low/medium/high)
- `complete_reminder(id)` — Mark reminders as done
- `remember_about_me(kind: "project", ...)` — Track active projects in memory

---

### 10. Temporal Intelligence

**What:** Understands time context and evolution

**Status:** Planned (Phase 4)

**Features:**
- **On This Day** — Past notes from same date
- **Thought Evolution** — How ideas changed over time
- **Periodic Reviews** — Daily/weekly/monthly summaries (daily digest implemented)
- **Future Reminders** — Resurface notes at right time

---

### 11. Relationship Intelligence

**What:** Tracks people, conversations, connections

**Status:** Basic person tracking via `remember_about_me(kind: "person")`, full system planned

**Features:**
- **People Tracking** — Remember everyone you mention
- **Conversation History** — All mentions of a person across notes
- **Meeting Prep** — Surface relevant context before meetings
- **Collaboration Tracking** — Projects/ideas shared with each person

---

### 12. Decision Support

**What:** Helps make better decisions with context

**Status:** Planned (Phase 4)

**Features:**
- **Decision Log** — Records decisions and reasoning
- **Context Retrieval** — Shows relevant past decisions
- **Outcome Tracking** — How decisions worked out
- **Pattern Recognition** — Your decision-making tendencies

---

### 13. Context Switching Support

**What:** Helps resume work after interruptions

**Status:** Planned, connected to Focus Sessions

**Features:**
- **Project Context** — Loads full context of a project
- **Where Was I** — Shows recent work on a topic
- **Quick Resume** — One command to load context
- **Focus Mode** — Filters noise, shows only relevant notes
- **Cross-Interface Persistence** — Focus session state persists across Telegram, Web, and TUI (stored in SQLite)

---

### 14. Knowledge Synthesis

**What:** Creates new understanding from accumulated knowledge

**Status:** Planned (Phase 4)

**Features:**
- **Cross-domain Insights** — Connects different knowledge areas
- **Pattern Extraction** — Finds common patterns across notes
- **Principle Derivation** — Distills principles from examples
- **Knowledge Compilation** — Creates comprehensive guides from scattered notes

---

### 15. Content Generation Intelligence

**What:** Creates in your voice, using your knowledge

**Status:** Implemented via content-creation plugin

Full details in [CONTENT_CREATION.md](./CONTENT_CREATION.md). Summary of implemented tools:
- `create_content(topic, content_type, length?, audience?, ...)` — RAG-based generation in your voice
- `analyze_my_style(force?)` — Learn your writing voice
- `get_style_profile()` — View current voice profile
- `mark_as_voice_example(note_id)` — Tag notes for style training

---

### 16. Data Import & Migration

**What:** Your brain doesn't start empty — absorb existing knowledge

**Status:** Planned (Phase 2 — high priority)

Your knowledge lives in many places. EchOS needs to pull it all together:

| Source | Priority | Strategy |
|--------|----------|----------|
| **Obsidian / Markdown vaults** | Highest | Near-native: copy `.md` files into knowledge dir. The reconciler (`reconciler.ts`) already syncs all `.md` files with `id` frontmatter → SQLite + LanceDB. Add UUID assignment for files without `id`. |
| **Notion** | High | API export or ZIP → convert pages to Markdown (notion-to-md) → drop into knowledge dir → reconciler handles the rest |
| **Apple Notes** | High | AppleScript extraction → Markdown conversion → knowledge dir |
| **Google Docs / Keep** | High | Google Takeout ZIP or API → Markdown → knowledge dir |
| **Readwise** | Medium | API sync → highlights as Markdown notes with source metadata |
| **Browser Bookmarks** | Medium | Export HTML → extract URLs → process each through `save_article` plugin |

**Design Principles:**
- **Everything becomes Markdown** — The universal format. The reconciler already handles `.md` → SQLite + LanceDB sync.
- **Deduplication is free** — SHA-256 content hashing (already in SQLite) prevents duplicate embeddings.
- **Import metadata preserved** — Frontmatter fields: `imported_from`, `original_id`, `imported_at`, `original_url`
- **Non-blocking bulk import** — Large imports queued through BullMQ content processor, processed async
- **Each import is a plugin** — Following the `EchosPlugin` pattern, registering tools like `import_from_obsidian`

**Import Pipeline:**
```
Source Data → Plugin Extracts → Normalize to Markdown
                                     │
                                     ▼
                              Knowledge Directory
                                     │
                                     ▼
                          Reconciler Syncs → SQLite + LanceDB
                                     │
                                     ▼
                          Optional: categorize_note (bulk)
```

---

### 17. Multi-media Intelligence

**What:** PDFs, images, and audio are first-class knowledge, not attachments

**Status:** Planned (Phase 2), voice transcription already working

The pipeline is consistent: **extract → normalize to text → embed → store as Markdown with frontmatter**.

| Media | Extraction | What You Get |
|-------|-----------|-------------|
| **PDFs** | Text extraction (pdf-parse), preserving page numbers | Full searchable text, page references, stored as `type: pdf` |
| **Images / Screenshots** | OCR (Tesseract) + LLM visual description | Extracted text + semantic description of what the image shows |
| **Audio / Podcasts** | OpenAI Whisper (already used for Telegram voice messages) | Timestamped transcript, speaker detection where possible |
| **Voice Messages** | **Already implemented** — Telegram voice → Whisper → agent | Transcribed text processed by agent immediately |

**Storage model:**
- Binary files stored in `data/attachments/` (gitignored)
- Markdown note created in knowledge dir with frontmatter referencing the attachment
- Full extracted text in the Markdown body — searchable via FTS5 and vectors
- Original file path in `source` frontmatter field

```yaml
---
id: img-whiteboard-001
type: image
title: "Architecture whiteboard photo - Feb 17"
source: "./attachments/whiteboard-2026-02-17.jpg"
extracted_at: 2026-02-17T14:30:00Z
tags: [architecture, meeting, api-design]
---

## OCR Text
[Extracted text from the whiteboard]

## Description
A whiteboard diagram showing the API gateway architecture with three
microservices, a Redis cache layer, and PostgreSQL database...
```

Each media type is implemented as a plugin following the existing pattern (see `plugins/article/` and `plugins/youtube/` for reference).

---

### 18. Focus Sessions

**What:** Deep work mode where the agent becomes your active thinking partner

**Status:** Planned (Phase 2 — user's top priority feature)

#### The Focus Session Lifecycle

```
START                    ACTIVE                         END
┌──────────┐    ┌────────────────────────┐    ┌─────────────────┐
│ Set topic │───▶│ Watch: new notes on    │───▶│ Session summary  │
│ Optional  │    │   topic auto-linked    │    │ Notes created: N │
│ duration  │    │ Suggest: surface       │    │ Connections: N   │
│           │    │   related knowledge    │    │ Key insights     │
│           │    │ Connect: find links    │    │ Open questions   │
│           │    │   between session notes│    │ Suggested next   │
└──────────┘    └────────────────────────┘    └─────────────────┘
```

**How it works:**
1. **Start**: `start_focus_session(topic, duration?)` — Agent acknowledges focus, loads relevant context
2. **During**: Every note created is auto-tagged with the session. Agent proactively surfaces connections, detects patterns, suggests related knowledge from the archive. Search results are boosted for session-relevant content.
3. **End**: `end_focus_session()` — Agent creates a synthesis note summarizing: what was created, connections discovered, insights generated, open questions remaining, suggested next steps

**Planned Tools:**
- `start_focus_session(topic, duration?)` — Begin focused work
- `end_focus_session()` — End session, generate synthesis
- `session_status()` — Check current session state and activity

**Storage:**
```sql
CREATE TABLE focus_sessions (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  started_at DATETIME NOT NULL,
  ended_at DATETIME,
  duration_minutes INTEGER,
  notes_created TEXT,    -- JSON array of note IDs
  insights_surfaced INTEGER,
  synthesis_note_id TEXT -- ID of the end-of-session summary
);
```

**Cross-interface persistence**: Session state is stored in SQLite, so you can start a focus session in Telegram, continue in the Web UI, and end in the TUI. The agent knows you're in focus mode regardless of channel.

**Examples:**
```
You: "Focus on API performance optimization"
→ "Focus session started: API performance optimization
   Loading context: 8 related notes found, 2 saved articles.
   I'll surface connections as you work."

[You create a note about caching strategies]
→ "Connected to your note about Redis configuration from January.
   Also: your article about CDN caching mentions a similar pattern."

[30 minutes later]
You: "End focus session"
→ "Session summary: API Performance Optimization (30 min)
   - 3 notes created
   - 5 connections discovered
   - Key insight: Your caching strategy combines 3 patterns
     from different domains
   - Open question: How does this interact with your auth layer?
   - Suggested next: Review your database query optimization notes"
```

---

### 19. Security & Data Protection

**What:** Your knowledge is sensitive — protect it accordingly

**Status:** Core security patterns implemented (input validation, SSRF prevention, rate limiting), encryption and backup planned

#### What's Built
- **Input validation** — Zod schemas on all inputs, URL validation (`validateUrl()`), HTML sanitization
- **Secret protection** — Pino redaction configured, no secrets in logs
- **Rate limiting** — Per-user request throttling
- **Auth verification** — User ID verified before processing

#### What's Planned
- **Encryption at rest** — AES-256 for SQLite database, optional per-note encryption for sensitive Markdown files
- **Automated backup** — Scheduled exports via scheduler:
  - Daily: SQLite database dump + Markdown archive (tar.gz)
  - Weekly: Full backup including LanceDB vectors and attachments
  - Configurable retention (default: 30 daily, 12 weekly)
- **Disaster recovery** — Restore from backup: extract Markdown files → reconciler rebuilds SQLite + LanceDB indexes automatically
- **Audit trail** — Security-relevant events logged via `createAuditLogger()` (already available in `@echos/shared`)

The Markdown-as-source-of-truth architecture means recovery is straightforward: restore the `.md` files, run the reconciler, and all indexes are rebuilt.

---

### 20. External Integrations & Webhooks

**What:** EchOS connects to your broader digital life

**Status:** Planned (Phase 5)

| Integration | Type | What It Does |
|-------------|------|-------------|
| **RSS Feeds** | Scheduler worker | Periodically fetch feeds, create notes from new articles |
| **GitHub** | Webhook / API | Watch repos for issues, PRs, releases → create tracking notes |
| **Calendar** | API sync | Import events for meeting prep context, deadline awareness |
| **Readwise** | API sync | Import highlights and annotations as notes |
| **Generic Webhook** | Fastify endpoint | Accept POST from IFTTT/Zapier/n8n → create notes |

All integrations follow the same principle: **external data → Markdown note → standard pipeline**. Each is implemented as either a plugin (for on-demand tools) or a scheduler worker (for periodic sync).

The generic webhook endpoint enables any service that supports webhooks to push data into EchOS:
```
POST /api/webhook/ingest
{
  "source": "ifttt",
  "title": "New bookmark",
  "content": "...",
  "tags": ["bookmark"],
  "metadata": { ... }
}
```

---

### 21. Offline & Local-First

**What:** Core functionality works without internet

**Status:** Architecture supports it, explicit offline mode planned (Phase 5)

| Capability | Offline? | Why |
|-----------|----------|-----|
| Read notes | Yes | Markdown files are local |
| Full-text search | Yes | SQLite FTS5 is local |
| Create / edit notes | Yes | Writes to local filesystem |
| Vector search | Yes | LanceDB embeddings cached locally |
| Content generation | No | Requires Claude API |
| Voice transcription | No | Requires OpenAI Whisper API |
| Embedding generation | No | Requires OpenAI API |
| Data import | Partial | Local sources (Obsidian, files) work; API sources don't |

**Sync on reconnect**: When internet returns, the reconciler detects changed files (via content hash) and generates embeddings for any new/modified notes. Non-blocking — you can keep working while sync happens in the background.

The local-first architecture is a natural consequence of Markdown as source of truth + SQLite + LanceDB — all embedded, no servers required for core operations.

---

## Feature Priority Matrix

### Phase 1: Foundation — DONE
- Perfect Memory & Recall (core tools)
- Intelligent Search (hybrid FTS5 + vector)
- Auto Organization & Tagging (`categorize_note`)
- Content Generation (`create_content`, style learning)
- Basic reminders and note management

### Phase 2: Expand Knowledge Sources — NEXT
- Data Import & Migration (Obsidian → Notion → Apple Notes → Google)
- Multi-media Intelligence (PDF, image/OCR, audio)
- Focus Sessions (user's top priority)

### Phase 3: Proactive Intelligence
- Full proactive system (pattern triggers, notification routing)
- Temporal Intelligence (on-this-day, thought evolution)
- Structured Creative Workflows (morning pages, evening reflection)
- Notification routing (Telegram push, email digest, in-app)

### Phase 4: Deep Understanding
- Knowledge Graph visualization (Web UI)
- Learning Enhancement (spaced repetition, quizzes)
- Decision Support (decision log, outcome tracking)
- Knowledge Synthesis (cross-domain insights)
- Personal Analytics (thought patterns, learning velocity)

### Phase 5: Ecosystem
- Relationship Intelligence (people tracking, meeting prep)
- External Integrations & Webhooks (RSS, GitHub, calendar)
- Offline mode (explicit offline/online state management)
- Encryption at rest & automated backup
- Context Switching (cross-interface session persistence)

---

## Daily Workflow Integration

### Morning

```
1. Daily digest arrives (Telegram or email)
   → Yesterday's activity summary
   → Reminders due today
   → "On this day" past notes
   → Meeting context for today's calendar

2. Start focus session on day's priority
   → Agent loads relevant context
   → Proactive suggestions begin
```

### During the Day

```
3. Capture everything, any format
   → Voice memo in Telegram → Whisper transcription → note
   → Photo of whiteboard → OCR + description → note
   → PDF from colleague → text extraction → searchable note
   → Quick text message → agent creates structured note

4. Focus session active
   → Agent surfaces connections as you work
   → New notes auto-tagged and linked
   → Related knowledge proactively suggested

5. Quick lookups
   → "What did Sarah say about the timeline?"
   → "Find my notes on caching strategies"
   → Agent searches hybrid (meaning + keywords)
```

### During Deep Work

```
6. Focus session deepens
   → Agent tracks your exploration path
   → Detects when you're circling back to earlier ideas
   → Suggests unexplored angles
   → "You've covered read performance and write performance,
      but haven't addressed consistency trade-offs yet"
```

### Evening

```
7. End focus session
   → Session synthesis: what you explored, created, connected
   → Open questions captured for tomorrow

8. Evening reflection prompt
   → Structured questions about the day
   → Creates daily synthesis note
   → Feeds into weekly pattern detection

9. Background processing overnight
   → Bulk categorization of any uncategorized notes
   → Connection detection across new notes
   → Pattern analysis for weekly review
```

### Weekly

```
10. Weekly synthesis (automatic)
    → Pattern analysis: recurring themes, emerging interests
    → Goal progress: projects advanced, reminders completed
    → Content suggestions: topics ripe for blog posts or threads
    → Learning velocity: new domains explored, mastery progression
    → Contradictions detected: ideas that conflict across notes
```

---

## Telegram Commands for Second Brain

```
/remember [fact]     → Store fact about you
/recall [topic]      → What do you know about this?
/search [query]      → Search all knowledge
/review              → Daily/weekly review
/focus [topic]       → Start focus session
/endfocus            → End focus session
/ideas               → Generate content ideas
/write [topic]       → Create content in your voice
/similar             → Find related notes
/on-this-day         → Past notes from today
/insights            → Personal analytics
/resume [project]    → Load project context
/import [source]     → Import from external tool
```

---

## Technical Implementation Notes

### Core Schema (Implemented)

```sql
-- Notes with full-text search (implemented in packages/core/src/storage/sqlite.ts)
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  type TEXT,
  title TEXT,
  body TEXT,
  category TEXT,
  tags TEXT,           -- JSON array
  metadata TEXT,       -- JSON object
  content_hash TEXT,   -- SHA-256 for embedding optimization
  created_at DATETIME,
  updated_at DATETIME
);
CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, content='notes');

-- Long-term memory (implemented)
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  kind TEXT,           -- fact, person, project, expertise, preference
  content TEXT,
  context TEXT,
  confidence REAL,
  created_at DATETIME,
  updated_at DATETIME
);

-- Reminders (implemented)
CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  title TEXT,
  content TEXT,
  due_date DATETIME,
  priority TEXT,       -- low, medium, high
  completed INTEGER DEFAULT 0,
  completed_at DATETIME,
  created_at DATETIME
);
```

### Planned Schema Extensions

```sql
-- Focus sessions (planned)
CREATE TABLE focus_sessions (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  started_at DATETIME NOT NULL,
  ended_at DATETIME,
  duration_minutes INTEGER,
  notes_created TEXT,         -- JSON array of note IDs
  insights_surfaced INTEGER,
  synthesis_note_id TEXT
);

-- Knowledge graph connections (planned)
CREATE TABLE connections (
  from_note_id TEXT,
  to_note_id TEXT,
  relationship TEXT,          -- related, contradicts, extends, example
  strength REAL,
  auto_detected BOOLEAN,
  created_at DATETIME
);

-- Learning progress (planned)
CREATE TABLE learning_progress (
  topic TEXT PRIMARY KEY,
  mastery_level INTEGER,      -- 1-5
  evidence_notes TEXT,        -- JSON array
  first_studied DATETIME,
  last_reviewed DATETIME,
  next_review DATETIME        -- spaced repetition
);
```

---

## Success Metrics

### Usage Metrics
- Notes created per week
- Searches per day
- Content generated per month
- Focus session frequency and duration
- Import volume (notes absorbed from external sources)

### Quality Metrics
- Memory recall accuracy (>95%)
- Search relevance (user clicks top-3 result >80%)
- Content authenticity (style match >85%)
- Proactive insight actionability (user acts on >30%)
- Multi-media extraction accuracy (>90%)

### Impact Metrics
- Time saved on content creation
- Learning retention improvement
- Ideas generated → executed ratio
- Context switch recovery time (minutes saved)
- Knowledge reuse rate (notes referenced in content generation)

---

## Comparison: Traditional Note-Taking vs EchOS Second Brain

| Traditional | EchOS Second Brain |
|------------|-------------------|
| Manual filing | Auto-organized by AI |
| Search by keyword | Search by meaning (hybrid) |
| No connections | Auto-linked knowledge graph |
| Passive storage | Proactive insights + focus sessions |
| Generic output | Content in your voice |
| Forgets context | Perfect recall with confidence scoring |
| No learning | Spaced repetition + mastery tracking |
| Isolated notes | Cross-domain knowledge synthesis |
| Manual review | Auto-generated daily/weekly reviews |
| Text only | PDFs, images, audio, voice as first-class |
| Single source | Import from Obsidian, Notion, Apple Notes, Google |
| Cloud-dependent | Local-first, works offline |

---

## The Ultimate Vision

After 6 months of use:

**Your second brain knows:**
- Everything you've learned (from every source you've ever used)
- How you think (patterns, preferences, blind spots)
- What you care about (goals, projects, relationships)
- Your voice (writes content you'd be proud to publish)
- Your rhythms (when you're productive, when you need a break)

**It can:**
- Answer any question from your accumulated knowledge
- Write content that sounds like you, not generic AI
- Surface connections you'd never have spotted
- Remind you of the right thing at the right time
- Help you focus deeply and track your exploration
- Import your entire knowledge history and make it searchable
- Work with any content type: text, voice, images, PDFs

**It feels like:**
- Talking to a smarter version of yourself
- Having perfect memory across every tool you've ever used
- Never losing a thought, no matter how you captured it
- Always having the right context, at the right time
- Thinking more clearly because your cognitive load is shared

This is not science fiction. The foundation is built. The architecture is sound.

Now we build outward.

---

## Cross-References

- **Content creation deep-dive** (style learning, voice cloning, templates, workflows): [CONTENT_CREATION.md](./CONTENT_CREATION.md)
- **Plugin development guide**: [../PLUGINS.md](../PLUGINS.md)
- **Architecture details**: [../ARCHITECTURE.md](../ARCHITECTURE.md)
- **Interface adapters** (Telegram, Web, TUI): [../INTERFACES.md](../INTERFACES.md)
- **Security model**: [../SECURITY.md](../SECURITY.md)
