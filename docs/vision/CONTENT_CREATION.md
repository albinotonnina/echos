# Content Creation & Memory Architecture

## The Content Creation Vision

### The Second Brain Principle

Your knowledge agent isn't just for storage — it's your **content creation partner** that:
- Learns your writing style and voice
- Uses your accumulated knowledge as context
- Helps you write in YOUR voice, not generic AI
- Remembers everything you've told it
- Connects ideas across your entire knowledge base

EchOS transforms from a **passive archive** into an **active creative partner**: an authentic digital twin for content creation.

### What's Built Today

EchOS already has a working content creation pipeline:

| Tool | Package | What It Does |
|------|---------|-------------|
| `create_content` | `plugins/content-creation` | Generate blog posts, articles, threads, emails, essays, tutorials in your voice |
| `analyze_my_style` | `plugins/content-creation` | Learn writing voice from notes tagged `voice-example` (statistical + LLM analysis) |
| `get_style_profile` | `plugins/content-creation` | View current voice characteristics, patterns, vocabulary |
| `mark_as_voice_example` | `plugins/content-creation` | Tag notes for style training |
| `remember_about_me` | `@echos/core` | Store personal facts/preferences with confidence scoring |
| `recall_knowledge` | `@echos/core` | Retrieve memories by topic |
| `search_knowledge` | `@echos/core` | Hybrid keyword + semantic search across all notes |
| `categorize_note` | `@echos/core` | AI-powered categorization (lightweight or full mode) |

Supporting infrastructure:
- **Storage sync**: Markdown (source of truth) + SQLite (FTS5) + LanceDB (vectors)
- **Content hashing**: SHA-256 prevents redundant embedding calls
- **Scheduler**: BullMQ workers for digest, reminders, async content processing
- **Voice transcription**: Telegram voice messages → Whisper → agent processing

### What's Next

This document covers the deeper vision for areas not yet built:
- Multi-media memory (PDFs, images, audio)
- Data import from external tools (Obsidian, Notion, Apple Notes, Google)
- Structured creative workflows (morning pages, evening reflection, content rituals)
- Version history and drafts
- Advanced voice cloning techniques

For the full second brain capability catalog, see [SECOND_BRAIN_FEATURES.md](./SECOND_BRAIN_FEATURES.md).

---

## Memory Architecture

### Memory Types

EchOS organizes knowledge into four memory categories:

| Memory Type | What It Stores | How It's Used |
|------------|---------------|--------------|
| **Episodic** | Specific events, conversations, experiences | Context for "what happened when" questions |
| **Semantic** | Facts about you — preferences, expertise, projects, style | Personalizes all agent responses and content |
| **Procedural** | Workflows, templates, behavior patterns | Learns how you work, suggests routines |
| **Style** | Writing voice profile, phrase banks, sentence patterns | Powers authentic content generation |

Today, semantic memory is implemented via `remember_about_me` (5 kinds: fact, person, project, expertise, preference) with confidence scoring. Style memory lives in the content-creation plugin's style profile system. Episodic and procedural memory are implicit in notes and will gain dedicated tracking in future phases.

### Multi-media Memory

**Status: Planned (Phase 3)**

Every content type follows the same pipeline: **extract → normalize to text → embed → store as Markdown with frontmatter**.

| Media Type | Extraction Method | Output |
|-----------|-------------------|--------|
| **PDFs** | Text extraction (pdf-parse) | Full text with page references, stored as `type: pdf` note |
| **Images/Screenshots** | OCR (Tesseract) + LLM description | Extracted text + visual description, stored as `type: image` note |
| **Audio/Podcasts** | Whisper transcription (already used for voice messages) | Timestamped transcript, stored as `type: audio` note |

Each produces a standard Markdown file with specialized frontmatter:

```yaml
---
id: abc-123
type: pdf
title: "Designing Data-Intensive Applications - Chapter 5"
source: "./attachments/ddia-ch5.pdf"
extracted_at: 2026-02-17T10:00:00Z
tags: [distributed-systems, replication]
---
```

Multi-media plugins follow the existing `EchosPlugin` pattern (see `plugins/article/` and `plugins/youtube/` for reference implementations). Binary files are stored in `data/attachments/` with Markdown notes referencing them.

### Data Import & Migration

**Status: Planned (Phase 3)**

Your brain doesn't start empty. EchOS needs to absorb your existing knowledge:

| Source | Strategy | Complexity |
|--------|----------|-----------|
| **Obsidian / Markdown vaults** | Near-native — copy `.md` files into knowledge dir, reconciler syncs automatically | Low |
| **Notion** | API export or ZIP → convert to Markdown via notion-to-md → reconciler | Medium |
| **Apple Notes** | AppleScript extraction → Markdown conversion → reconciler | Medium |
| **Google Docs / Keep** | Google Takeout export or API → Markdown conversion → reconciler | Medium |
| **Readwise** | API → Markdown with highlight metadata → reconciler | Low-Medium |
| **Browser bookmarks** | Export HTML → extract URLs → article plugin processes each | Low |

Each import source is implemented as a plugin following the `EchosPlugin` interface, registering tools like `import_from_obsidian`, `import_from_notion`, etc.

**Key design decisions:**
- All imports normalize to Markdown — the universal format that the reconciler already handles
- Deduplication via existing SHA-256 content hashing (same content won't be re-embedded)
- Import metadata preserved in frontmatter (`imported_from`, `original_id`, `imported_at`)
- Bulk imports run through the scheduler's content processor queue to avoid blocking
- Files without `id` frontmatter are assigned UUIDs during import

---

## Style Learning System

### How Style Learning Works

The content-creation plugin (`plugins/content-creation/src/`) implements a two-phase style analysis:

1. **Statistical analysis**: Word frequency, sentence length distribution, paragraph structure, vocabulary richness
2. **LLM analysis**: Tone identification, voice characteristics, rhetorical patterns, phrase banking

The resulting profile captures:

| Dimension | What's Measured | Example |
|-----------|----------------|---------|
| Tone | Overall voice feel | `["direct", "technical", "occasional humor"]` |
| Formality | Register level | `professional-casual` |
| Vocabulary | Word choice patterns | Common terms, avoided words, domain jargon |
| Structure | Sentence/paragraph patterns | Avg sentence length, list preference, paragraph cadence |
| Phrases | Distinctive expressions | Transitions, emphasis patterns, hedges, closings |
| Samples | Representative paragraphs | Used as few-shot examples during generation |

**Minimum requirement**: 5 notes tagged `voice-example` (configurable). More examples = better profile.

### Continuous Style Learning

The style profile isn't static. As you write more:
- New voice examples can be added anytime via `mark_as_voice_example`
- Re-running `analyze_my_style` with `force: true` rebuilds the profile
- Future: automatic periodic re-analysis via scheduler, weighted toward recent writing

### Voice Cloning Techniques

**Phrase banking** — The system collects your distinctive phrases organized by function:
- *Transitions*: "Here's the thing:", "That said,"
- *Emphasis*: "This is crucial:", "Pay attention:"
- *Hedges*: "In my experience,", "Generally speaking,"
- *Closings*: "Bottom line:", "Long story short:"

During generation, these replace generic AI transitions with your actual voice.

**Sentence pattern matching** — Learns your construction patterns (e.g., "I think [clause] because [clause]") and restructures generated sentences to match your rhythm.

**Style verification** — After generation, content is scored against your profile. If similarity drops below threshold, targeted refinement adjusts specific passages while preserving meaning.

---

## Context-Aware Content Creation

### The RAG Pipeline

Every content creation request follows this flow:

```
User Request ("Write about X using what I know")
        │
        ▼
┌──────────────────┐
│ Memory Retrieval  │  search_knowledge (hybrid: FTS5 + LanceDB vectors)
│                  │  recall_knowledge (personal memories)
│                  │  Related notes via link graph
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Context Assembly  │  Knowledge chunks ranked by relevance
│                  │  Style profile loaded
│                  │  User preferences from memory
│                  │  Content template structure
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Generation        │  LLM with: retrieved context + style instructions
│                  │  + voice examples + template structure
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Style Verify      │  Score against profile, refine if needed
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Save & Deliver    │  Store as note with generation metadata
│                  │  (sources, style_score, content_type)
└──────────────────┘
```

### Version History & Drafts

**Status: Planned (Phase 4)**

Notes evolve. The version history system tracks that evolution:

- **Draft status** in frontmatter: `status: draft | review | published`
- **Git-based versioning**: Every save creates a git commit in the knowledge directory, enabling full history
- **Diff view**: See how a note changed over time
- **Branch drafts**: Work on alternative versions without affecting the original

This leverages the fact that Markdown files are the source of truth — they're naturally git-friendly.

---

## Structured Creative Workflows

**Status: Planned (Phase 3)**

These workflows leverage the existing scheduler infrastructure (BullMQ + CRON) to create recurring creative rituals.

### Morning Pages

A daily prompt delivered at your chosen time:
- Agent provides a journal template with contextual prompts
- References yesterday's notes, upcoming calendar, active projects
- Auto-categorizes the resulting entry as `journal` with date tags
- Builds episodic memory over time

### Evening Reflection

End-of-day structured review:
- Reviews all notes created today
- Asks structured reflection questions ("What went well?", "What surprised you?", "What's unresolved?")
- Creates a daily synthesis note linking the day's work
- Feeds into weekly pattern detection

### Content Ritual

Weekly cadence for turning knowledge into output:
- Surfaces topics where you have 5+ notes but no published content
- Suggests content formats based on topic shape (listicle, deep-dive, thread)
- Tracks content pipeline: idea → draft → review → published

### Learning Review

Spaced repetition connected to your knowledge base:
- Surfaces notes at optimal review intervals
- Generates comprehension questions from your own notes
- Tracks mastery progression per topic
- Connects to the Learning Enhancement feature in [SECOND_BRAIN_FEATURES.md](./SECOND_BRAIN_FEATURES.md)

---

## Content Templates & Types

| Template | Structure | Best For |
|----------|-----------|----------|
| `blog_post` | Hook → Context → Main points → Examples → Conclusion | Long-form thought pieces |
| `article` | Thesis → Evidence → Analysis → Conclusion | Structured arguments |
| `tutorial` | What we'll build → Prerequisites → Steps → Troubleshooting → Next steps | Teaching |
| `thread` | Hook tweet → Setup → Main points (1 per tweet) → Conclusion | Twitter/LinkedIn |
| `email` | Context → Purpose → Details → Action items | Professional communication |
| `essay` | Opening → Exploration → Synthesis → Closing thought | Personal reflection |
| `newsletter` | Intro → Sections with highlights → Links → Sign-off | Regular audience updates |
| `changelog` | Version → Breaking changes → Features → Fixes → Migration notes | Release communication |
| `meeting_notes` | Attendees → Agenda → Discussion → Decisions → Action items | Meeting follow-up |
| `presentation_outline` | Title → Problem → Solution → Evidence → Demo → Call to action | Talk preparation |

Templates guide structure; your style profile provides the voice. The combination produces content that's both well-organized and authentically yours.

---

## Measuring Success

### Content Quality Metrics

| Metric | Target | How Measured |
|--------|--------|-------------|
| Style similarity score | >85% | LLM comparison against voice examples |
| Knowledge utilization | >3 source notes per generation | Tracked in generation metadata |
| User acceptance rate | >70% first-draft usable | User feedback (edit vs. regenerate) |
| Voice authenticity | "Sounds like me" | Periodic user self-assessment |

### System Health Metrics

| Metric | Target | How Measured |
|--------|--------|-------------|
| Import success rate | >95% per source | Import job completion tracking |
| Multi-media extraction accuracy | >90% text fidelity | Spot-check samples |
| Workflow completion rate | >60% prompted workflows completed | Scheduler job tracking |
| Style profile freshness | Updated within 30 days | Last analysis timestamp |

---

## Implementation Priority

### Phase 1: Foundation — DONE
- Basic knowledge tools (`create_note`, `search_knowledge`, `get_note`, `list_notes`, `update_note`, `delete_note`)
- Long-term memory (`remember_about_me`, `recall_knowledge`)
- Auto-categorization (`categorize_note`)
- Note linking (`link_notes`)
- Reminders (`add_reminder`, `complete_reminder`)

### Phase 2: Content Creation — DONE
- Style analysis (`analyze_my_style`, `get_style_profile`, `mark_as_voice_example`)
- RAG-based content generation (`create_content`)
- Article extraction plugin (`save_article`)
- YouTube transcript plugin (`save_youtube`)
- Voice message transcription (Telegram + Whisper)
- Storage sync (reconciler + file watcher)
- Scheduler with digest and reminder workers

### Phase 3: Expansion — NEXT
- Multi-media plugins (PDF, image/OCR, audio/podcast)
- Data import pipeline (Obsidian, Notion, Apple Notes, Google)
- Structured creative workflows (morning pages, evening reflection, content ritual)
- Bulk import via scheduler queue

### Phase 4: Refinement — FUTURE
- Advanced voice cloning (phrase injection, sentence pattern matching)
- Version history with git-based tracking
- Draft status workflow (draft → review → published)
- Continuous automatic style re-analysis
- Content performance tracking

---

## Cross-References

- **Full second brain capability catalog**: [SECOND_BRAIN_FEATURES.md](./SECOND_BRAIN_FEATURES.md)
- **Plugin development guide**: [../PLUGINS.md](../PLUGINS.md)
- **Architecture details**: [../ARCHITECTURE.md](../ARCHITECTURE.md)
- **Interface adapters** (Telegram, Web, TUI): [../INTERFACES.md](../INTERFACES.md)
