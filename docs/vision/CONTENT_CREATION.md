# Content Creation & Memory Architecture

## The Second Brain Principle

Your knowledge agent isn't just for storage - it's your **content creation partner** that:
- Learns your writing style and voice
- Uses your accumulated knowledge as context
- Helps you write in YOUR voice, not generic AI
- Remembers everything you've told it
- Connects ideas across your entire knowledge base

Like openclaw's integration with pi-mono, we need **strong memory architecture** where the agent truly knows you.

## Core Concepts

### 1. Memory Types

```typescript
interface Memory {
  // Episodic: Specific events/conversations
  episodic: {
    conversations: Conversation[];
    experiences: Event[];
    context: ConversationContext[];
  };
  
  // Semantic: Facts about the user
  semantic: {
    preferences: UserPreferences;
    expertise: string[];
    projects: Project[];
    writing_style: StyleProfile;
    voice: VoiceProfile;
  };
  
  // Procedural: How user works
  procedural: {
    workflows: Workflow[];
    templates: Template[];
    patterns: BehaviorPattern[];
  };
}
```

### 2. Style Learning System

**The agent learns your voice through:**
- Analyzing your past notes/journals
- Tracking word choices, sentence structure
- Identifying recurring phrases
- Understanding your tone patterns
- Learning domain-specific vocabulary

```typescript
interface StyleProfile {
  // Linguistic features
  vocabulary_level: 'casual' | 'professional' | 'academic';
  sentence_complexity: number; // avg words per sentence
  paragraph_length: number;
  
  // Voice characteristics
  tone: string[]; // ['direct', 'humorous', 'technical']
  common_phrases: string[];
  avoided_words: string[]; // words you never use
  
  // Structural patterns
  prefers_lists: boolean;
  uses_metaphors: boolean;
  storytelling_style: 'chronological' | 'thematic' | 'problem-solution';
  
  // Domain vocabulary
  technical_terms: Map<string, number>; // usage frequency
  domain_expertise: string[];
  
  // Examples
  sample_paragraphs: string[]; // representative of your style
}
```

### 3. Context-Aware Content Creation

Every content creation request uses RAG (Retrieval Augmented Generation):

```
User: "Write a blog post about the async Rust patterns I've been learning"

Agent reasoning:
1. Search: "async Rust patterns" in my knowledge
2. Find: 5 notes about async/await, 2 saved articles, 1 YouTube transcript
3. Extract: Key concepts I've learned, specific examples I've noted
4. Recall: My writing style profile
5. Generate: Blog post in MY voice, using MY insights, with MY examples
```

## Architecture: Memory + Content Creation

```
┌─────────────────────────────────────────────────────┐
│                   User Request                      │
│  "Write a post about X using what I know"          │
└────────────────────┬────────────────────────────────┘
                     │
        ┌────────────▼────────────┐
        │   Memory Retrieval      │
        │                         │
        │  1. Semantic search     │
        │  2. Related notes       │
        │  3. Past conversations  │
        │  4. Relevant examples   │
        └────────────┬────────────┘
                     │
        ┌────────────▼────────────┐
        │   Context Assembly      │
        │                         │
        │  - Knowledge chunks     │
        │  - Style profile        │
        │  - User preferences     │
        │  - Relevant templates   │
        └────────────┬────────────┘
                     │
        ┌────────────▼────────────┐
        │   Content Generation    │
        │                         │
        │  LLM with:              │
        │  - Retrieved context    │
        │  - Style instructions   │
        │  - Template structure   │
        │  - Your voice examples  │
        └────────────┬────────────┘
                     │
        ┌────────────▼────────────┐
        │   Style Verification    │
        │                         │
        │  - Check against profile│
        │  - Adjust if needed     │
        │  - Ensure authenticity  │
        └────────────┬────────────┘
                     │
        ┌────────────▼────────────┐
        │   Deliver Content       │
        │  + Save as new note     │
        └─────────────────────────┘
```

## Tool: Learn Writing Style

```typescript
export function analyzeStyleTool(storage: StorageService): ToolDefinition {
  return {
    name: "analyze_my_style",
    description: "Analyze user's writing style from their notes and journals to learn their voice",
    
    parameters: Type.Object({
      sample_size: Type.Optional(Type.Number({
        description: "Number of recent notes to analyze (default: 50)"
      })),
      note_types: Type.Optional(Type.Array(Type.String(), {
        description: "Types of notes to analyze (e.g., ['journal', 'note'])"
      })),
    }),
    
    async execute({ sample_size = 50, note_types = ['journal', 'note'] }) {
      // 1. Retrieve sample of user's writing
      const notes = await storage.searchNotes('', {
        types: note_types,
        limit: sample_size,
        sort: 'recent'
      });
      
      // 2. Extract text corpus
      const corpus = notes.map(n => n.content).join('\n\n');
      
      // 3. Analyze with LLM
      const analysis = await analyzeLinguisticStyle(corpus);
      
      // 4. Save style profile
      await saveStyleProfile(analysis);
      
      return {
        content: [{
          type: "text",
          text: `✅ Analyzed ${notes.length} notes\n\n` +
                `**Your Writing Style:**\n` +
                `- Tone: ${analysis.tone.join(', ')}\n` +
                `- Avg sentence length: ${analysis.avgSentenceLength} words\n` +
                `- Vocabulary: ${analysis.vocabularyLevel}\n` +
                `- Common phrases: ${analysis.commonPhrases.slice(0, 5).join(', ')}\n\n` +
                `I'll use this profile when creating content for you.`
        }]
      };
    }
  };
}

async function analyzeLinguisticStyle(corpus: string): Promise<StyleProfile> {
  // Call LLM with special prompt
  const prompt = `Analyze this person's writing style. Extract:
1. Tone and voice characteristics
2. Common phrases and idioms they use
3. Sentence structure preferences
4. Vocabulary level
5. Technical terms they use frequently
6. Words/phrases they avoid
7. Their storytelling patterns

Text corpus:
${corpus}

Return detailed JSON analysis.`;

  const response = await callLLM(prompt);
  return JSON.parse(response);
}
```

## Tool: Create Content in My Voice

```typescript
export function createContentTool(
  storage: StorageService,
  styleProfile: StyleProfile
): ToolDefinition {
  return {
    name: "create_content",
    description: "Create content (blog post, article, essay) using your knowledge and writing style",
    
    parameters: Type.Object({
      topic: Type.String({ 
        description: "What to write about" 
      }),
      content_type: Type.Union([
        Type.Literal("blog_post"),
        Type.Literal("article"),
        Type.Literal("essay"),
        Type.Literal("tutorial"),
        Type.Literal("thread"), // Twitter/LinkedIn thread
        Type.Literal("email"),
      ], {
        description: "Type of content to create"
      }),
      length: Type.Optional(Type.Union([
        Type.Literal("short"),   // 300-500 words
        Type.Literal("medium"),  // 800-1200 words
        Type.Literal("long"),    // 1500-2500 words
      ])),
      use_recent_notes: Type.Optional(Type.Boolean({
        description: "Prioritize recent notes for context"
      })),
    }),
    
    async execute({ topic, content_type, length = "medium", use_recent_notes = true }) {
      // 1. Retrieve relevant knowledge
      const relevantNotes = await storage.searchNotes(topic, {
        limit: 20,
        semantic: true,
        sort: use_recent_notes ? 'recent' : 'relevance'
      });
      
      // 2. Extract key points and examples
      const context = relevantNotes.map(note => ({
        title: note.title,
        key_points: extractKeyPoints(note.content),
        examples: extractExamples(note.content),
        source: note.id
      }));
      
      // 3. Build generation prompt with style instructions
      const styleInstructions = buildStyleInstructions(styleProfile);
      const contentPrompt = buildContentPrompt({
        topic,
        content_type,
        length,
        context,
        styleInstructions,
        examples: styleProfile.sample_paragraphs
      });
      
      // 4. Generate content
      const content = await generateContent(contentPrompt);
      
      // 5. Verify style match (optional refinement)
      const styleMatch = await verifyStyleMatch(content, styleProfile);
      if (styleMatch.score < 0.8) {
        content = await refineStyle(content, styleProfile, styleMatch.issues);
      }
      
      // 6. Save as new note
      const noteId = await storage.saveNote({
        type: 'note',
        title: `${content_type}: ${topic}`,
        content: content,
        tags: ['generated', content_type, ...extractTopicTags(topic)],
        metadata: {
          generated: true,
          topic,
          sources: relevantNotes.map(n => n.id),
          style_score: styleMatch.score
        }
      });
      
      return {
        content: [{
          type: "text",
          text: `✅ Created ${content_type} about "${topic}"\n\n` +
                `📊 Used ${relevantNotes.length} of your notes as context\n` +
                `✍️ Style match: ${(styleMatch.score * 100).toFixed(0)}%\n` +
                `📄 Saved as note: ${noteId}\n\n` +
                `**Preview:**\n${content.substring(0, 300)}...`
        }]
      };
    }
  };
}

function buildStyleInstructions(profile: StyleProfile): string {
  return `
Write in this specific style:

TONE: ${profile.tone.join(', ')}
VOCABULARY: ${profile.vocabulary_level}
SENTENCE STRUCTURE: Average ${profile.sentence_complexity} words per sentence
PARAGRAPH LENGTH: ${profile.paragraph_length} sentences

USE THESE PHRASES: ${profile.common_phrases.slice(0, 10).join(', ')}
AVOID THESE WORDS: ${profile.avoided_words.join(', ')}

STRUCTURAL PREFERENCES:
${profile.prefers_lists ? '- Use bullet points and lists' : '- Prefer flowing prose'}
${profile.uses_metaphors ? '- Include metaphors and analogies' : '- Stay concrete and literal'}
- Storytelling: ${profile.storytelling_style}

VOICE EXAMPLES (write like this):
${profile.sample_paragraphs.slice(0, 3).map((p, i) => `Example ${i + 1}:\n${p}`).join('\n\n')}

CRITICAL: This must sound like the author wrote it themselves, not like AI.
Use their exact vocabulary, phrasing patterns, and voice.
`;
}
```

## Tool: Remember This About Me

```typescript
export function rememberMeTool(storage: StorageService): ToolDefinition {
  return {
    name: "remember_about_me",
    description: "Store important facts about the user for long-term memory",
    
    parameters: Type.Object({
      category: Type.Union([
        Type.Literal("preference"),
        Type.Literal("expertise"),
        Type.Literal("project"),
        Type.Literal("goal"),
        Type.Literal("habit"),
        Type.Literal("fact"),
      ]),
      content: Type.String({ 
        description: "What to remember" 
      }),
      context: Type.Optional(Type.String({
        description: "Additional context or why this matters"
      })),
    }),
    
    async execute({ category, content, context }) {
      // Store in special "memory" collection
      const memoryNote = await storage.saveNote({
        type: 'note',
        title: `Memory: ${category}`,
        content: `**Category:** ${category}\n\n${content}${context ? `\n\n**Context:** ${context}` : ''}`,
        tags: ['memory', category],
        metadata: {
          is_memory: true,
          category,
          timestamp: new Date().toISOString()
        }
      });
      
      // Also update semantic memory index
      await updateSemanticMemory(category, content);
      
      return {
        content: [{
          type: "text",
          text: `✅ I'll remember: ${content}`
        }]
      };
    }
  };
}
```

## Tool: What Do You Know About Topic X?

```typescript
export function recallKnowledgeTool(storage: StorageService): ToolDefinition {
  return {
    name: "recall_knowledge",
    description: "Recall everything the user has told you about a topic",
    
    parameters: Type.Object({
      topic: Type.String(),
      include_timeline: Type.Optional(Type.Boolean({
        description: "Show when information was learned"
      })),
    }),
    
    async execute({ topic, include_timeline = false }) {
      // 1. Semantic search across all notes
      const notes = await storage.searchNotes(topic, {
        semantic: true,
        limit: 50
      });
      
      // 2. Extract relevant excerpts
      const knowledge = notes.map(note => ({
        excerpt: extractRelevantExcerpt(note.content, topic),
        source: note.title,
        date: note.created,
        type: note.type
      }));
      
      // 3. Organize by theme or timeline
      const organized = include_timeline 
        ? organizeByTimeline(knowledge)
        : organizeByTheme(knowledge);
      
      // 4. Synthesize
      const synthesis = await synthesizeKnowledge(organized, topic);
      
      return {
        content: [{
          type: "text",
          text: `**What I know about "${topic}":**\n\n${synthesis}\n\n` +
                `📚 Based on ${notes.length} notes/entries`
        }]
      };
    }
  };
}
```

## Content Creation Workflows

### Workflow 1: Blog Post from Recent Learning

```
User: "Write a blog post about what I learned this week about Rust async"

Agent:
1. search_knowledge("Rust async", date_from="last 7 days")
2. recall_knowledge("Rust async") // broader context
3. analyze_my_style() // ensure style is current
4. create_content(
     topic="Rust async patterns",
     type="blog_post",
     use_recent_notes=true
   )
5. Returns: Draft in user's voice, with their examples, their insights
```

### Workflow 2: Twitter Thread from Note

```
User: "Turn my note about dependency injection into a Twitter thread"

Agent:
1. search_knowledge("dependency injection")
2. Extract key points
3. create_content(
     topic="dependency injection",
     type="thread",
     length="short"
   )
4. Returns: 8-tweet thread, each in user's voice, bite-sized
```

### Workflow 3: Email Using Context

```
User: "Draft an email to Sarah about our API redesign discussion"

Agent:
1. search_knowledge("Sarah API redesign")
2. recall_knowledge("Sarah") // past interactions
3. recall_knowledge("API redesign") // technical context
4. create_content(
     topic="API redesign update for Sarah",
     type="email"
   )
5. Returns: Email that references specific past discussions, 
            uses user's professional tone, includes relevant details
```

### Workflow 4: Learning Summary

```
User: "Summarize everything I've learned about machine learning"

Agent:
1. recall_knowledge("machine learning", include_timeline=true)
2. Organize by: concepts learned, tools used, projects done
3. create_content(
     topic="My ML journey",
     type="article",
     length="long"
   )
4. Returns: Comprehensive summary showing progression of learning
```

## Memory System Implementation

### Persistent Memory Store

```typescript
// In addition to notes, maintain a structured memory database

interface MemoryStore {
  // Quick facts about user
  facts: Map<string, {
    content: string;
    confidence: number;
    last_updated: Date;
    sources: string[]; // note IDs
  }>;
  
  // Projects user is working on
  projects: Map<string, {
    name: string;
    description: string;
    status: 'active' | 'paused' | 'completed';
    related_notes: string[];
  }>;
  
  // People user mentions
  people: Map<string, {
    name: string;
    relationship: string;
    context: string;
    mentioned_in: string[]; // note IDs
  }>;
  
  // User's expertise areas
  expertise: Map<string, {
    domain: string;
    level: 'learning' | 'proficient' | 'expert';
    evidence: string[]; // note IDs showing expertise
  }>;
  
  // Recurring themes
  themes: Map<string, {
    theme: string;
    frequency: number;
    notes: string[];
  }>;
}

// Update memory store as notes are created
async function updateMemoryStore(note: Note) {
  // Extract entities (people, projects, topics)
  const entities = await extractEntities(note.content);
  
  // Update facts
  const facts = await extractFacts(note.content);
  for (const fact of facts) {
    memoryStore.facts.set(fact.key, {
      content: fact.value,
      confidence: fact.confidence,
      last_updated: new Date(),
      sources: [note.id]
    });
  }
  
  // Update projects
  const projects = entities.filter(e => e.type === 'project');
  for (const project of projects) {
    if (!memoryStore.projects.has(project.name)) {
      memoryStore.projects.set(project.name, {
        name: project.name,
        description: project.description,
        status: 'active',
        related_notes: [note.id]
      });
    } else {
      const existing = memoryStore.projects.get(project.name)!;
      existing.related_notes.push(note.id);
    }
  }
  
  // Update people
  const people = entities.filter(e => e.type === 'person');
  for (const person of people) {
    if (!memoryStore.people.has(person.name)) {
      memoryStore.people.set(person.name, {
        name: person.name,
        relationship: person.relationship,
        context: extractPersonContext(note.content, person.name),
        mentioned_in: [note.id]
      });
    } else {
      memoryStore.people.get(person.name)!.mentioned_in.push(note.id);
    }
  }
}
```

## Style Learning Process

### Initial Style Analysis

When user first sets up the system:

```typescript
async function initialStyleSetup(storage: StorageService) {
  console.log("Learning your writing style...");
  
  // 1. Import existing notes if any
  const existingNotes = await importExistingNotes();
  
  // 2. Analyze
  if (existingNotes.length >= 10) {
    await analyzeStyleTool.execute({ sample_size: existingNotes.length });
  } else {
    console.log("Need at least 10 notes to learn your style.");
    console.log("Write some journal entries or notes, then run /analyze-style");
  }
}
```

### Continuous Style Learning

```typescript
// Update style profile periodically as user writes
async function updateStyleProfile() {
  const recentNotes = await storage.searchNotes('', {
    types: ['journal', 'note'],
    date_from: thirtyDaysAgo(),
    limit: 30
  });
  
  if (recentNotes.length >= 10) {
    const newAnalysis = await analyzeLinguisticStyle(
      recentNotes.map(n => n.content).join('\n')
    );
    
    // Merge with existing profile (weighted toward recent)
    currentStyleProfile = mergeStyleProfiles(
      currentStyleProfile,
      newAnalysis,
      { recent_weight: 0.3 }
    );
  }
}
```

## Advanced: Voice Cloning Techniques

### Phrase Banking

```typescript
// Collect user's distinctive phrases
const phraseBank = {
  // Transition phrases
  transitions: [
    "Here's the thing:",
    "That said,",
    "The way I see it,",
  ],
  
  // Emphasis patterns
  emphasis: [
    "This is crucial:",
    "Pay attention to this:",
  ],
  
  // Hedges/qualifiers
  hedges: [
    "I think",
    "In my experience,",
    "Generally speaking,",
  ],
  
  // Closings
  closings: [
    "Long story short:",
    "Bottom line:",
  ]
};

// When generating content, sample from phrase bank
function injectUserPhrases(content: string, phraseBank: PhraseBank): string {
  // Intelligently inject user's actual phrases
  // Replace generic AI phrases with user's voice
}
```

### Sentence Pattern Matching

```typescript
// Learn user's sentence construction patterns
interface SentencePattern {
  structure: string; // e.g., "I think [clause] because [clause]"
  frequency: number;
  examples: string[];
}

const patterns = learnSentencePatterns(userWriting);

// When generating, use these patterns
function generateInUserStyle(content: string, patterns: SentencePattern[]): string {
  // Restructure sentences to match user's patterns
}
```

## Integration with Telegram

```typescript
// Special Telegram commands for content creation

bot.onText(/\/write (.+)/, async (msg, match) => {
  const topic = match[1];
  
  const session = await getSession(msg.chat.id);
  
  await session.prompt(
    `Create a blog post about ${topic} using my knowledge and writing style`,
    {
      onChunk: (chunk) => updateTelegramMessage(msg.chat.id, chunk)
    }
  );
});

bot.onText(/\/thread (.+)/, async (msg, match) => {
  const topic = match[1];
  
  // Generate Twitter thread
  await session.prompt(
    `Turn my notes about ${topic} into a Twitter thread in my voice`
  );
});

bot.onText(/\/recall (.+)/, async (msg, match) => {
  const topic = match[1];
  
  // Recall everything about topic
  await session.prompt(
    `What do I know about ${topic}? Include timeline.`
  );
});
```

## Examples of Generated Content

### Before: Generic AI Writing
```
"Asynchronous programming in Rust offers several advantages. The async/await 
syntax provides a clean and intuitive way to write concurrent code. This 
approach helps developers manage complex workflows efficiently."
```

### After: In User's Voice
```
"Here's the thing about async Rust - it's a total game changer once you get 
past the initial learning curve. The async/await syntax feels natural, almost 
like writing synchronous code. I've been using it in my API project and the 
performance gains are real."
```

## Content Templates

```typescript
const templates = {
  blog_post: {
    structure: [
      'hook',
      'context',
      'main_points',
      'examples',
      'conclusion'
    ],
    styleGuide: 'Use storytelling, personal anecdotes, concrete examples'
  },
  
  tutorial: {
    structure: [
      'what_well_build',
      'prerequisites',
      'step_by_step',
      'troubleshooting',
      'next_steps'
    ],
    styleGuide: 'Clear, concise, actionable. Code snippets with explanations.'
  },
  
  thread: {
    structure: [
      'hook_tweet',
      'setup_tweets',
      'main_points_tweets',
      'conclusion_tweet'
    ],
    styleGuide: 'Punchy, conversational, one idea per tweet'
  }
};
```

## Measuring Success

### Style Similarity Score

```typescript
async function calculateStyleSimilarity(
  generated: string,
  userSamples: string[]
): Promise<number> {
  // Use LLM to compare
  const prompt = `
Rate how similar this generated text is to the user's writing samples.
Score from 0.0 (completely different) to 1.0 (indistinguishable).

Generated:
${generated}

User samples:
${userSamples.join('\n---\n')}

Return just the numeric score.
`;
  
  const score = await callLLM(prompt);
  return parseFloat(score);
}
```

## Implementation Priority

1. **Phase 1:** Basic memory tools (remember_about_me, recall_knowledge)
2. **Phase 2:** Style analysis (analyze_my_style)
3. **Phase 3:** Content creation (create_content)
4. **Phase 4:** Continuous learning and refinement
5. **Phase 5:** Advanced voice cloning techniques

## Summary

This transforms your knowledge agent from a **passive archive** into an **active creative partner**:

- ✅ Learns and mimics your writing style
- ✅ Uses your knowledge as context
- ✅ Remembers facts about you
- ✅ Creates content that sounds like YOU
- ✅ Continuously improves as you write more
- ✅ Strong memory like openclaw

The agent becomes your **authentic digital twin** for content creation.
