# AI-Powered Categorization

EchOS uses Claude AI to automatically categorize and summarize content. This feature helps organize your knowledge base with minimal manual effort.

## Overview

The categorization system offers two processing modes:

| Mode | Speed | Output | Best For |
|------|-------|--------|----------|
| **Lightweight** | ~1-2 seconds | Category + Tags | Quick organization, batch processing |
| **Full** | ~3-5 seconds | Category + Tags + Gist + Summary + Key Points | Important content, detailed analysis |

Both modes use Claude AI (Haiku 4.5) to analyze content and extract structured metadata.

## Usage

### Auto-Categorize on Save

When saving articles or YouTube videos, use the `autoCategorize` parameter:

```typescript
// Via natural language (agent decides)
"Save this article with categorization: https://example.com/article"

// The agent will call save_article with autoCategorize=true
```

**Example interaction:**
```
User: Save this TypeScript article with full categorization: https://example.com/ts-guide

Agent: I'll save that article with full AI categorization.
[Fetching article from https://example.com/ts-guide...]
[Categorizing article with AI...]

Saved article "Complete TypeScript Guide" (id: abc-123)
Source: https://example.com/ts-guide
Content: 8,432 characters
Category: programming
Tags: [typescript, javascript, type-safety, web-development]
Gist: Comprehensive guide to TypeScript's type system and best practices
```

### Categorize Existing Notes

Use the `categorize_note` tool to analyze content that's already saved:

```typescript
// Lightweight mode (fast)
"Categorize note abc-123 in lightweight mode"

// Full mode (detailed)
"Categorize my note about machine learning in full mode"
```

**Example output:**
```
Categorized note "Introduction to ML" (full mode)
Category: machine-learning
Tags: [ml, ai, neural-networks, data-science]
Gist: Overview of supervised and unsupervised learning algorithms
Summary: Machine learning is a subset of artificial intelligence...
Key Points:
  - Supervised learning requires labeled training data
  - Neural networks can learn complex patterns
  - Cross-validation prevents overfitting
  - Feature engineering is crucial for model performance
```

## Processing Modes

### Lightweight Mode

**Speed:** ~1-2 seconds  
**API Cost:** ~500 tokens  
**Output:**
- `category`: Single category (e.g., "programming", "health", "finance")
- `tags`: 3-5 relevant tags for organization

**When to use:**
- Quick categorization of many items
- When you don't need summaries
- Batch processing existing notes
- Speed is more important than detail

### Full Mode

**Speed:** ~3-5 seconds  
**API Cost:** ~2000 tokens  
**Output:**
- `category`: Single category
- `tags`: 3-5 relevant tags
- `gist`: One-sentence summary (max 100 characters)
- `summary`: Comprehensive summary (2-3 paragraphs)
- `keyPoints`: 3-5 actionable takeaways

**When to use:**
- Important articles or videos
- Content you'll reference frequently
- When you need quick summaries
- Research or learning materials

## Categories

The AI automatically selects appropriate categories based on content. Common categories include:

- `programming` - Software development, coding
- `machine-learning` - AI, ML, data science
- `health` - Fitness, nutrition, medical
- `finance` - Money, investing, economics
- `personal` - Personal notes, reflections
- `work` - Professional, career
- `productivity` - Time management, tools
- `science` - Research, discoveries
- `philosophy` - Ideas, thinking
- `uncategorized` - Fallback when unclear

Categories are not predefined—the AI suggests the most appropriate one for each piece of content.

## Technical Details

### Architecture

```
User Request
    ↓
Plugin Tool (save_article, save_youtube, categorize_note)
    ↓
categorizeContent(title, content, mode, apiKey, logger)
    ↓
Anthropic Claude API (structured JSON extraction)
    ↓
Parse & Validate Response
    ↓
Update Metadata (SQLite + Markdown + VectorDB)
```

### Implementation

The categorization service is in `packages/core/src/agent/categorization.ts`:

```typescript
import { categorizeContent } from '@echos/core';

// Lightweight categorization
const result = await categorizeContent(
  title,
  content,
  'lightweight',
  anthropicApiKey,
  logger,
);
// Returns: { category: string, tags: string[] }

// Full processing
const fullResult = await categorizeContent(
  title,
  content,
  'full',
  anthropicApiKey,
  logger,
);
// Returns: { category, tags, gist, summary, keyPoints }
```

### Content Length Limits

- **Lightweight mode**: First 5,000 characters analyzed
- **Full mode**: First 10,000 characters analyzed

Longer content is automatically truncated. This balances quality with API costs.

### Error Handling

The service includes robust error handling:

```typescript
// On API failure or invalid response
{
  category: 'uncategorized',
  tags: [],
  gist: title.slice(0, 100),      // Fallback to title
  summary: content.slice(0, 500), // Fallback to content preview
  keyPoints: []
}
```

Errors are logged but don't prevent content from being saved.

## Configuration

Categorization requires an Anthropic API key in `.env`:

```bash
ANTHROPIC_API_KEY=your-key-here
```

The feature is automatically available once the key is configured. No additional setup required.

## API Reference

### categorizeContent()

```typescript
function categorizeContent(
  title: string,
  content: string,
  mode: ProcessingMode,
  apiKey: string,
  logger: Logger,
): Promise<CategorizationResult | FullProcessingResult>
```

**Parameters:**
- `title`: Content title
- `content`: Full text content
- `mode`: `'lightweight'` or `'full'`
- `apiKey`: Anthropic API key
- `logger`: Pino logger instance

**Returns:**

For lightweight mode:
```typescript
interface CategorizationResult {
  category: string;
  tags: string[];
}
```

For full mode:
```typescript
interface FullProcessingResult {
  category: string;
  tags: string[];
  gist: string;
  summary: string;
  keyPoints: string[];
}
```

### categorizeLightweight()

```typescript
function categorizeLightweight(
  title: string,
  content: string,
  apiKey: string,
  logger: Logger,
): Promise<CategorizationResult>
```

Direct access to lightweight mode processing.

### processFull()

```typescript
function processFull(
  title: string,
  content: string,
  apiKey: string,
  logger: Logger,
): Promise<FullProcessingResult>
```

Direct access to full mode processing.

## Agent Tools

### categorize_note

Manually categorize existing notes:

```typescript
{
  name: 'categorize_note',
  parameters: {
    noteId: string,              // ID of note to categorize
    mode: 'lightweight' | 'full' // Processing mode
  }
}
```

**Example:**
```
Agent: "I'll categorize that note for you."
[Calls categorize_note with noteId='abc-123', mode='full']
```

### Plugin Parameters

Both `save_article` and `save_youtube` support:

```typescript
{
  url: string,                        // Required
  tags?: string[],                    // Optional manual tags
  category?: string,                  // Optional manual category
  autoCategorize?: boolean,           // Enable AI categorization (default: false)
  processingMode?: 'lightweight' | 'full' // AI mode (default: 'full')
}
```

## Best Practices

### When to Use Lightweight Mode

- Processing multiple items at once
- Don't need summaries immediately
- Want to minimize API costs
- Content is straightforward to categorize

### When to Use Full Mode

- Saving important reference material
- Need quick summaries for later
- Content is complex or technical
- Want structured key takeaways

### Manual vs. Auto-Categorization

**Manual** (specify category/tags in the command):
- You know exactly how to categorize
- Content is personal or context-specific
- Want consistent naming

**Auto** (let AI decide):
- Discovering new topics
- Content is unfamiliar
- Want objective categorization
- Processing public/professional content

### Batch Processing

For categorizing many existing notes:

```typescript
// Get all uncategorized notes
const notes = await sqlite.listNotes({ category: 'uncategorized' });

// Process in lightweight mode for speed
for (const note of notes) {
  await agent.prompt(`Categorize note ${note.id} in lightweight mode`);
}
```

## Performance

### Token Usage

| Mode | Input | Output | Total |
|------|-------|--------|-------|
| Lightweight | ~300-400 | ~100-200 | ~500 |
| Full | ~1200-1500 | ~500-800 | ~2000 |

### Response Times

Times measured with typical article content (~3000 words):

- **Lightweight**: 1-2 seconds
- **Full**: 3-5 seconds

Network latency and API load can affect these times.

### Cost Estimation

Based on Anthropic Claude Haiku 4.5 pricing ($0.80/MTok input, $4/MTok output):

| Mode | Cost per Item |
|------|---------------|
| Lightweight | ~$0.0010 |
| Full | ~$0.0045 |

Costs are approximate and vary by content length.

## Troubleshooting

### "Categorization failed"

**Cause:** API error, rate limit, or invalid key

**Fix:**
1. Check `ANTHROPIC_API_KEY` is valid
2. Verify API rate limits not exceeded
3. Check content isn't too long (>10k chars)
4. Review logs for specific error

### Missing gist/summary in results

**Cause:** Using lightweight mode

**Fix:** Use full mode instead:
```
"Categorize with full mode" or autoCategorize=true, processingMode='full'
```

### Incorrect categories

**Cause:** Content is ambiguous or AI misinterpreted

**Fix:** 
- Provide more context in the content
- Manually specify category
- Add manual tags to guide categorization

### Rate limiting

**Cause:** Too many API requests in short time

**Fix:**
- Use lightweight mode for batch processing
- Add delays between requests
- Check Anthropic rate limits for your tier

## Examples

### Example 1: Save Article with Auto-Categorization

```
User: Save this ML article with categorization: https://example.com/neural-nets

Agent: I'll fetch and categorize that article.
[Fetching article from https://example.com/neural-nets...]
[Categorizing article with AI...]

Saved article "Neural Networks Explained" (id: xyz-789)
Source: https://example.com/neural-nets
Content: 6,245 characters
Category: machine-learning
Tags: [neural-networks, deep-learning, ai, backpropagation]
Gist: Introduction to feedforward neural networks and training algorithms
```

### Example 2: Categorize Existing Note (Full Mode)

```
User: Categorize my Rust programming note in full mode

Agent: I'll analyze that note with full categorization.

Categorized note "Getting Started with Rust" (full mode)
Category: programming
Tags: [rust, systems-programming, memory-safety, performance]
Gist: Overview of Rust's ownership system and zero-cost abstractions
Summary: Rust is a systems programming language that guarantees memory 
safety without garbage collection. The ownership system prevents data 
races at compile time. Rust's performance matches C/C++ while providing 
modern language features like pattern matching and type inference.
Key Points:
  - Ownership rules prevent memory leaks and data races
  - Zero-cost abstractions don't sacrifice performance
  - Cargo provides excellent dependency management
  - Strong type system catches errors at compile time
  - Growing ecosystem for web, embedded, and systems development
```

### Example 3: Lightweight Batch Processing

```
User: Categorize all my uncategorized notes quickly

Agent: I'll categorize your uncategorized notes in lightweight mode.
[Found 15 uncategorized notes]

Processing note 1/15... Done (Category: personal, Tags: [reflection, goals])
Processing note 2/15... Done (Category: work, Tags: [meeting-notes, project-x])
Processing note 3/15... Done (Category: health, Tags: [exercise, nutrition])
...
Completed: 15 notes categorized
```

## Content Taxonomy

Beyond categorization (category + tags), EchOS tracks content through a lifecycle:

### ContentType

| Type | Description | Default Status |
|------|-------------|----------------|
| `note` | User-authored note | `read` |
| `journal` | Diary/reflection entry | `read` |
| `conversation` | Saved conversation summary | `read` |
| `article` | Saved web article | `saved` |
| `youtube` | Saved YouTube transcript | `saved` |
| `reminder` | Task reminder | n/a |

### ContentStatus

| Status | Meaning | When set |
|--------|---------|----------|
| `saved` | Captured, not yet consumed | Default for article/youtube saves |
| `read` | User has engaged with the content | Default for authored notes; set explicitly or auto-detected |
| `archived` | Hidden from normal search | User request or explicit archiving |

**Status transitions:**
- Articles/YouTube start as `saved` — they're in the reading list, not the knowledge base
- Authored notes (`note`, `journal`, `conversation`) start as `read`
- The agent auto-marks content as `read` when the user begins discussing it
- Use `mark_content(id, 'read')` to mark explicitly, or ask the agent "I've read that article"

### InputSource

Tracks how content was captured:
- `text` — typed by user (default for create_note)
- `voice` — from a transcribed voice message
- `url` — from a pasted URL (save_article, save_youtube)
- `file` — from a file

### Filtering by Status

```
"Show my reading list"
→ list_notes(status="saved")

"What have I read about TypeScript?"
→ search_knowledge("TypeScript") — agent prioritizes read over saved content

"Archive that article"
→ mark_content(id, "archived")
```

## See Also

- [PLUGINS.md](PLUGINS.md) - How to add categorization to custom plugins
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture overview
- [Core source code](../packages/core/src/agent/categorization.ts) - Implementation details
