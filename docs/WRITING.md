# Writing & Voice

EchOS has two separate but complementary features for shaping how language is used:

| Feature | What it controls | How to change it |
|---|---|---|
| **Agent voice** | How EchOS *talks to you* | Tell it in plain language |
| **Style profile** | How EchOS *writes on your behalf* | Tag examples, run `analyze_my_style` |

These are completely independent. You can have a casual, warm conversational agent that writes formal long-form articles for you — or a terse, no-nonsense assistant that writes breezy blog posts.

---

## Agent voice

Agent voice controls EchOS's conversational register — its tone, verbosity, warmth, and personality when replying to you.

### How to change it

Just say what you want in plain language. No commands, no settings panel.

```
You:    Be concise and serious. No fluff.
EchOS:  Got it — I'll keep responses tight and direct.

You:    Actually, be a bit warmer. I want to feel supported.
EchOS:  Sure — I'll stay concise but add more warmth.

You:    Be playful and use light humour where appropriate.
EchOS:  Done. I'll keep things light when the moment's right.

You:    Reset your voice to default.
EchOS:  Back to my default tone.
```

EchOS interprets your words and writes its own directive — so "be more chill" becomes a coherent instruction it will actually follow.

### What persists

- **Takes effect immediately** in the same conversation
- **Persists across sessions** — stored in the database, loaded into the system prompt on startup. You don't need to repeat yourself next time.

### Under the hood

The `set_agent_voice` tool is called automatically when you ask for a tone change. It writes a 1–3 sentence second-person directive (e.g. *"Be concise and direct. Skip preambles and filler phrases."*) that becomes part of the system prompt for all future messages. Passing an empty string resets it to default.

---

## Style profile (content creation plugin)

The style profile is used when EchOS *generates content for you* — blog posts, articles, threads, emails, essays, and tutorials. It learns your authentic writing voice from pieces you've curated, then uses that profile when generating new content.

This feature is provided by the **content-creation plugin** and must be enabled in your config.

### Workflow

#### 1. Curate voice examples

Pick 5–15 pieces of writing that represent your authentic voice at its best — published posts, polished notes, anything you're proud of.

> Good voice examples:
> - Published work you'd put your name on
> - 500+ words
> - Representative of how you actually write (not how you *want* to write)
> - Not rough drafts or quick notes

If the content is already in EchOS as a note, mark it as a voice example:

```
Mark note <note-id> as a voice example
```

This calls `mark_as_voice_example`, which adds the `voice-example` tag to the note.

If it's not in EchOS yet, create a note first:

```
Save this as a note: [paste your writing]
```

Then mark it.

#### 2. Analyze your style

Once you have at least 5 voice examples tagged:

```
Analyze my writing style
```

This calls `analyze_my_style`, which:
- Finds all notes tagged `voice-example`
- Runs statistical analysis (sentence length, paragraph structure, vocabulary richness)
- Runs an LLM pass to extract tone descriptors, formality level, storytelling approach, signature phrases
- Merges both into a profile saved to `data/style-profile.json`

The result looks like:

```
✅ Style analysis complete!

Analyzed: 8 voice examples
Your voice characteristics:
- Tone: analytical, conversational, direct
- Formality: semi-formal
- Emotional range: moderate
- Perspective: first-person

Writing style:
- Average sentence length: 14 words (balanced)
- Paragraph style: short paragraphs
- Prefers lists: Yes
- Uses metaphors: Yes
- Storytelling approach: narrative-driven
```

#### 3. Generate content

```
Write a blog post about [topic]
Write a thread about [topic] for a technical audience
Draft an email to [recipient] about [topic]
```

This calls `create_content`, which:
- Loads your style profile (or falls back to a sensible default if none exists)
- Retrieves relevant notes from your knowledge base via semantic search
- Generates the content using your profile as a style guide and your notes as context
- Saves the result as a new note (tagged `generated`, `ai-generated`, and the content type)

Content types: `blog_post`, `article`, `thread`, `email`, `essay`, `tutorial`

Optional parameters you can mention naturally:
- Target length: *"write a short blog post"*, *"write around 800 words"*
- Audience: *"for a non-technical audience"*, *"for senior engineers"*
- Recency: *"only use notes from the last month"*
- Extra instructions: *"keep it punchy, don't use bullet points"*

#### 4. Inspect your profile

```
Show me my style profile
```

This calls `get_style_profile` and displays your full profile — tone descriptors, vocabulary analysis, sentence patterns, transition phrases, and sample paragraphs that exemplify your style.

#### 5. Update your profile

After accumulating more writing or if your style evolves:

```
Re-analyze my style
```

This forces a fresh analysis even if a profile already exists.

### Default profile

`create_content` works even without a custom style profile — it falls back to a default professional voice. The generated content will include a note prompting you to set up your own profile for more authentic results.

### Storage

The style profile is stored at `data/style-profile.json`. It is not synced via git (listed in `.gitignore`). Generated content is saved as regular markdown notes alongside your other knowledge.

---

## Quick reference

| What you say | What happens |
|---|---|
| *"Be more concise"* | `set_agent_voice` updates conversational tone |
| *"Mark note abc-123 as a voice example"* | `mark_as_voice_example` tags the note |
| *"Analyze my writing style"* | `analyze_my_style` builds style profile |
| *"Show me my style profile"* | `get_style_profile` displays current profile |
| *"Write a blog post about X"* | `create_content` generates in your voice |
| *"Re-analyze my style"* | `analyze_my_style` with force re-analysis |
| *"Reset your voice to default"* | `set_agent_voice` clears the voice directive |
