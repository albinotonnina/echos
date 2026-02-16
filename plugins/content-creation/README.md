# Content Creation Plugin

AI-powered content generation in your authentic writing voice.

## Overview

The content-creation plugin transforms EchOS from a passive knowledge archive into an active creative partner. It learns your writing style from curated examples and generates blog posts, articles, threads, emails, essays, and tutorials that sound like you wrote them.

## Key Features

- **Ready Out-of-the-Box**: Start generating with default voice profile immediately
- **Curated Voice Learning**: Learns from notes you explicitly tag as "voice-example" (not all notes)
- **Hybrid Style Analysis**: Combines statistical and LLM-based analysis for rich voice profiles
- **RAG-Based Generation**: Uses your knowledge base for accurate, personalized content
- **Multiple Content Types**: Blog posts, articles, threads, essays, tutorials, emails
- **Cost Effective**: ~$0.50-1.00/month for active use

## Quick Start

### Option 1: Start Generating Immediately (Default Voice)

You can start generating content right away using the built-in default voice profile:

```
create_content {
  topic: "getting started with Rust",
  content_type: "blog_post"
}
```

The default profile provides a balanced, professional yet approachable writing style suitable for most content types.

### Option 2: Create Your Custom Voice (Recommended)

For content that truly sounds like YOU wrote it:

#### 1. Curate Voice Examples

Tag 5-15 notes that represent your best writing:

```
mark_as_voice_example { note_id: "your-note-id" }
```

**What makes a good voice example:**
- Published work you're proud of
- Polished pieces (not rough drafts)
- 500+ words of your authentic voice
- Representative of how you want to write

### 2. Analyze Your Style

```
analyze_my_style
```

This creates a detailed style profile including:
- Voice characteristics (tone, formality, emotional range)
- Writing patterns (sentence starters, transitions, emphasis phrases)
- Structural preferences (lists, metaphors, storytelling approach)
- Vocabulary profile (signature words, jargon level)

### 3. Generate Content

```
create_content {
  topic: "async Rust patterns",
  content_type: "blog_post",
  target_length: 1500,
  audience: "intermediate Rust developers"
}
```

The generated content will:
- Use your authentic voice and style
- Draw from your knowledge base
- Match the specified content type structure
- Be saved as a new note with "ai-generated" tag

## Tools

### `analyze_my_style`

Analyzes your writing style from voice examples.

**Parameters:**
- `force_reanalysis` (optional): Re-analyze even if profile exists
- `min_examples` (optional): Minimum voice examples required (default: 5)

**Cost:** ~$0.02-0.05 per analysis

### `create_content`

Generates content in your voice.

**Parameters:**
- `topic` (required): Subject to write about
- `content_type` (required): One of: blog_post, article, thread, email, essay, tutorial
- `target_length` (optional): Target word count
- `use_recent_notes` (optional): Only use notes from last 30 days
- `audience` (optional): Target audience description
- `additional_instructions` (optional): Specific instructions

**Cost:** ~$0.02-0.05 per generation

### `get_style_profile`

View your current style profile.

No parameters. Returns detailed summary of voice characteristics, patterns, vocabulary, and examples.

### `mark_as_voice_example`

Tag a note as a voice example for style learning.

**Parameters:**
- `note_id` (required): ID of note to mark

## Content Types

### Blog Post (blog_post)
Long-form article for blogs. 800-2500 words.
- Compelling headline
- Hook opening
- 3-5 main sections with examples
- Actionable takeaways

### Article (article)
General article for publication. 1000-3000 words.
- Strong lead paragraph
- Evidence-based arguments
- Journalistic structure

### Thread (thread)
Twitter/LinkedIn thread. 400-1500 words.
- Hook post
- Connected series of posts
- Punchy, scannable format

### Essay (essay)
Thoughtful exploration of ideas. 1200-3500 words.
- Personal and reflective
- Nuanced examination
- Storytelling techniques

### Tutorial (tutorial)
Step-by-step guide. 800-3000 words.
- Clear prerequisites
- Numbered instructions
- Troubleshooting section

### Email (email)
Professional or personal email. 100-500 words.
- Brief and purposeful
- Clear call-to-action
- Professional tone

## Architecture

```
plugins/content-creation/
├── src/
│   ├── types.ts                   # Type definitions
│   ├── index.ts                   # Plugin entry point
│   ├── tools/                     # Agent tools
│   │   ├── analyze-style.ts
│   │   ├── create-content.ts
│   │   ├── get-style-profile.ts
│   │   └── mark-voice-example.ts
│   ├── style/                     # Style analysis
│   │   ├── storage.ts             # JSON persistence
│   │   ├── llm-analyzer.ts        # LLM-based analysis
│   │   └── profile-builder.ts     # Merge statistical + LLM
│   └── content/                   # Content generation
│       ├── templates.ts           # Content type templates
│       ├── prompt-builder.ts      # Generation prompts
│       ├── knowledge-retriever.ts # RAG search
│       └── generator.ts           # LLM generation
```

## How It Works

### Style Analysis

1. **Voice Example Collection**: Retrieves notes tagged "voice-example"
2. **Statistical Analysis**: Calculates sentence length, vocabulary richness, common phrases
3. **LLM Analysis**: Extracts voice characteristics, patterns, structure preferences
4. **Profile Building**: Merges insights into EnhancedStyleProfile
5. **Storage**: Saves to `data/style-profile.json`

### Content Generation

1. **Knowledge Retrieval**: Hybrid search (semantic + keyword) for relevant notes
2. **Context Building**: Extracts key points and examples from notes
3. **Prompt Construction**: Combines style instructions, templates, and context
4. **Generation**: LLM generates content matching your voice
5. **Note Creation**: Saves as new note with proper metadata and tags

## Best Practices

1. **Curate Quality Examples**: 10-20 polished pieces > 100 mixed-quality notes
2. **Update Periodically**: Re-analyze as your voice evolves
3. **Review Before Publishing**: AI-generated content should be reviewed/edited
4. **Use Generated Content as Voice Examples**: After polishing, add to voice examples
5. **Experiment with Content Types**: Different types have different structures

## Default Voice Profile

The plugin includes a default voice profile with these characteristics:

- **Tone**: Clear, direct, professional, approachable
- **Formality**: Professional
- **Structure**: Uses lists, medium paragraphs, problem-solution approach
- **Vocabulary**: Accessible professional language, minimal jargon

This default works well for:
- Technical documentation
- Blog posts and articles
- Professional emails
- Tutorials and guides

To create content in YOUR unique voice, follow the Quick Start Option 2 above.

## Troubleshooting

**"Not enough voice examples found"**
- You can still generate content using the default voice profile
- To create your custom voice: tag more notes with "voice-example" and use `mark_as_voice_example` tool

**Generated content doesn't sound like you**
- Check your voice examples are representative
- Add more diverse examples
- Re-run analysis with `force_reanalysis: true`

## Configuration

The plugin uses existing EchOS configuration:
- `anthropicApiKey`: Required for style analysis and generation
- `openaiApiKey`: Required for embeddings (knowledge retrieval)

No additional configuration needed!

## Future Enhancements

- Multiple style profiles (professional vs. casual)
- Style verification (compare generated to actual)
- Automatic continuous learning
- Multi-language support
- Custom content type templates
