// Example Tool Implementations
// These show the pattern for building knowledge management tools

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-agent-core";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

// ============================================================================
// Storage Service (to be implemented)
// ============================================================================

interface Note {
  id: string;
  filepath: string;
  type: 'note' | 'journal' | 'article' | 'youtube' | 'reminder';
  title: string;
  content: string;
  created: string;
  updated: string;
  tags: string[];
  links: string[];
  metadata?: Record<string, any>;
}

class StorageService {
  constructor(private baseDir: string) {}
  
  async saveNote(note: Note): Promise<string> {
    const filepath = this.determineFilepath(note);
    const markdown = this.formatMarkdown(note);
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, markdown, 'utf-8');
    return filepath;
  }
  
  async getNote(id: string): Promise<Note | null> {
    // Implementation: Query SQLite index, read file
    throw new Error("Not implemented");
  }
  
  async searchNotes(query: string, filters?: any): Promise<Note[]> {
    // Implementation: SQLite FTS5 + vector search
    throw new Error("Not implemented");
  }
  
  private determineFilepath(note: Note): string {
    const date = new Date(note.created);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    
    switch (note.type) {
      case 'journal':
        const day = String(date.getDate()).padStart(2, '0');
        return path.join(this.baseDir, 'journal', `${year}`, `${month}`, `${day}.md`);
      
      case 'article':
        return path.join(this.baseDir, 'articles', 'saved', `${this.slugify(note.title)}.md`);
      
      case 'youtube':
        return path.join(this.baseDir, 'youtube', 'transcripts', `${this.slugify(note.title)}.md`);
      
      case 'reminder':
        return path.join(this.baseDir, 'reminders', `${note.id}.md`);
      
      default: // 'note'
        return path.join(this.baseDir, 'notes', `${this.slugify(note.title)}.md`);
    }
  }
  
  private formatMarkdown(note: Note): string {
    const frontmatter = {
      id: note.id,
      type: note.type,
      title: note.title,
      created: note.created,
      updated: note.updated,
      tags: note.tags,
      links: note.links,
      ...note.metadata,
    };
    
    const yaml = Object.entries(frontmatter)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          return `${key}: [${value.map(v => `"${v}"`).join(', ')}]`;
        }
        return `${key}: ${JSON.stringify(value)}`;
      })
      .join('\n');
    
    return `---\n${yaml}\n---\n\n${note.content}`;
  }
  
  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}

// ============================================================================
// Tool: Create Note
// ============================================================================

export function createNoteTool(storage: StorageService): ToolDefinition {
  return {
    name: "create_note",
    description: "Create a new note in the knowledge base. Use this for capturing thoughts, ideas, meeting notes, or any information you want to save.",
    
    parameters: Type.Object({
      title: Type.String({ 
        description: "Title of the note" 
      }),
      content: Type.String({ 
        description: "Content in markdown format" 
      }),
      type: Type.Union([
        Type.Literal("note"),
        Type.Literal("journal"),
        Type.Literal("idea"),
        Type.Literal("technical"),
        Type.Literal("meeting"),
      ], {
        description: "Type of note. Use 'journal' for daily entries, 'technical' for code/tech notes, 'meeting' for meeting notes."
      }),
      tags: Type.Optional(Type.Array(Type.String(), {
        description: "Tags for organization (e.g., ['rust', 'async', 'learning'])"
      })),
      links: Type.Optional(Type.Array(Type.String(), {
        description: "IDs of related notes to link to"
      })),
    }),
    
    async execute({ title, content, type, tags = [], links = [] }) {
      try {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        
        const note: Note = {
          id,
          filepath: '', // Will be determined by storage service
          type: type as any,
          title,
          content,
          created: now,
          updated: now,
          tags,
          links,
        };
        
        const filepath = await storage.saveNote(note);
        
        // Update bidirectional links if specified
        if (links.length > 0) {
          await updateBacklinks(storage, id, links);
        }
        
        return {
          content: [{
            type: "text",
            text: `✅ Created ${type}: **${title}**\n📁 ${filepath}\n🆔 ${id}${tags.length > 0 ? `\n🏷️ ${tags.join(', ')}` : ''}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `❌ Failed to create note: ${error.message}`
          }]
        };
      }
    }
  };
}

// ============================================================================
// Tool: Search Knowledge
// ============================================================================

export function searchKnowledgeTool(storage: StorageService): ToolDefinition {
  return {
    name: "search_knowledge",
    description: "Search across all notes, journals, articles, and transcripts. Supports both keyword search and semantic search.",
    
    parameters: Type.Object({
      query: Type.String({ 
        description: "Search query - can be keywords or natural language question" 
      }),
      type_filter: Type.Optional(Type.Array(Type.String(), {
        description: "Filter by note types (e.g., ['note', 'article'])"
      })),
      tag_filter: Type.Optional(Type.Array(Type.String(), {
        description: "Filter by tags"
      })),
      date_from: Type.Optional(Type.String({
        description: "Filter notes created after this date (ISO 8601)"
      })),
      date_to: Type.Optional(Type.String({
        description: "Filter notes created before this date (ISO 8601)"
      })),
      limit: Type.Optional(Type.Number({
        description: "Maximum number of results (default: 10)"
      })),
    }),
    
    async execute({ query, type_filter, tag_filter, date_from, date_to, limit = 10 }) {
      try {
        const results = await storage.searchNotes(query, {
          types: type_filter,
          tags: tag_filter,
          dateFrom: date_from,
          dateTo: date_to,
          limit,
        });
        
        if (results.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No results found for: "${query}"`
            }]
          };
        }
        
        const formatted = results.map((note, i) => 
          `${i + 1}. **${note.title}** (${note.type})\n` +
          `   📅 ${new Date(note.created).toLocaleDateString()}\n` +
          `   🆔 ${note.id}\n` +
          (note.tags.length > 0 ? `   🏷️ ${note.tags.join(', ')}\n` : '') +
          `   📝 ${note.content.substring(0, 150)}...`
        ).join('\n\n');
        
        return {
          content: [{
            type: "text",
            text: `Found ${results.length} result(s) for: "${query}"\n\n${formatted}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `❌ Search failed: ${error.message}`
          }]
        };
      }
    }
  };
}

// ============================================================================
// Tool: Save Article
// ============================================================================

export function saveArticleTool(storage: StorageService): ToolDefinition {
  return {
    name: "save_article",
    description: "Fetch and save a web article. Extracts main content, removes ads/clutter, and saves as markdown.",
    
    parameters: Type.Object({
      url: Type.String({ 
        description: "URL of the article to save" 
      }),
      tags: Type.Optional(Type.Array(Type.String(), {
        description: "Tags to organize this article"
      })),
      create_summary: Type.Optional(Type.Boolean({
        description: "Whether to generate an AI summary of the article"
      })),
    }),
    
    async execute({ url, tags = [], create_summary = false }) {
      try {
        // 1. Fetch article content (use readability or similar)
        const article = await fetchArticleContent(url);
        
        // 2. Optionally generate summary
        let content = article.markdown;
        if (create_summary) {
          const summary = await generateSummary(content);
          content = `## Summary\n\n${summary}\n\n## Full Article\n\n${content}`;
        }
        
        // 3. Create note
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        
        const note: Note = {
          id,
          filepath: '',
          type: 'article',
          title: article.title,
          content,
          created: now,
          updated: now,
          tags,
          links: [],
          metadata: {
            source_url: url,
            author: article.author,
            published_date: article.publishedDate,
          }
        };
        
        const filepath = await storage.saveNote(note);
        
        return {
          content: [{
            type: "text",
            text: `✅ Saved article: **${article.title}**\n` +
                  `🔗 ${url}\n` +
                  `📁 ${filepath}\n` +
                  `🆔 ${id}` +
                  (create_summary ? '\n📝 Summary generated' : '')
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `❌ Failed to save article: ${error.message}`
          }]
        };
      }
    }
  };
}

// ============================================================================
// Tool: Save YouTube Transcript
// ============================================================================

export function saveYouTubeTool(storage: StorageService): ToolDefinition {
  return {
    name: "save_youtube_transcript",
    description: "Download and save a YouTube video transcript with metadata.",
    
    parameters: Type.Object({
      url: Type.String({ 
        description: "YouTube video URL" 
      }),
      include_timestamps: Type.Optional(Type.Boolean({
        description: "Include timestamps in the transcript"
      })),
      identify_chapters: Type.Optional(Type.Boolean({
        description: "Use AI to identify chapter breaks in the transcript"
      })),
      tags: Type.Optional(Type.Array(Type.String())),
    }),
    
    async execute({ url, include_timestamps = false, identify_chapters = false, tags = [] }) {
      try {
        // 1. Extract video ID
        const videoId = extractYouTubeVideoId(url);
        
        // 2. Fetch transcript and metadata
        const [transcript, metadata] = await Promise.all([
          fetchYouTubeTranscript(videoId),
          fetchYouTubeMetadata(videoId),
        ]);
        
        // 3. Format transcript
        let content = formatTranscript(transcript, include_timestamps);
        
        // 4. Optionally identify chapters
        if (identify_chapters) {
          const chapters = await identifyChapters(content);
          content = formatWithChapters(content, chapters);
        }
        
        // 5. Build full markdown
        const fullContent = 
          `## Video Information\n\n` +
          `- **Channel:** ${metadata.channel}\n` +
          `- **Published:** ${metadata.publishedDate}\n` +
          `- **Duration:** ${formatDuration(metadata.duration)}\n` +
          `- **Views:** ${metadata.views.toLocaleString()}\n\n` +
          `## Description\n\n${metadata.description}\n\n` +
          `## Transcript\n\n${content}`;
        
        // 6. Save as note
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        
        const note: Note = {
          id,
          filepath: '',
          type: 'youtube',
          title: metadata.title,
          content: fullContent,
          created: now,
          updated: now,
          tags: [...tags, metadata.channel],
          links: [],
          metadata: {
            source_url: url,
            video_id: videoId,
            channel: metadata.channel,
            duration: metadata.duration,
          }
        };
        
        const filepath = await storage.saveNote(note);
        
        return {
          content: [{
            type: "text",
            text: `✅ Saved YouTube transcript: **${metadata.title}**\n` +
                  `📺 ${metadata.channel}\n` +
                  `🔗 ${url}\n` +
                  `📁 ${filepath}\n` +
                  `⏱️ ${formatDuration(metadata.duration)}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `❌ Failed to save transcript: ${error.message}`
          }]
        };
      }
    }
  };
}

// ============================================================================
// Tool: Add Reminder
// ============================================================================

export function addReminderTool(storage: StorageService): ToolDefinition {
  return {
    name: "add_reminder",
    description: "Add a reminder or todo item. Can set due dates and priorities.",
    
    parameters: Type.Object({
      text: Type.String({ 
        description: "Reminder text" 
      }),
      due_date: Type.Optional(Type.String({
        description: "Due date in ISO 8601 format"
      })),
      priority: Type.Optional(Type.Union([
        Type.Literal("low"),
        Type.Literal("medium"),
        Type.Literal("high"),
      ], {
        description: "Priority level"
      })),
      tags: Type.Optional(Type.Array(Type.String())),
    }),
    
    async execute({ text, due_date, priority = "medium", tags = [] }) {
      try {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        
        const note: Note = {
          id,
          filepath: '',
          type: 'reminder',
          title: text,
          content: text,
          created: now,
          updated: now,
          tags,
          links: [],
          metadata: {
            completed: false,
            due_date,
            priority,
          }
        };
        
        const filepath = await storage.saveNote(note);
        
        // TODO: Schedule system notification if due_date is set
        
        return {
          content: [{
            type: "text",
            text: `✅ Added reminder: **${text}**\n` +
                  (due_date ? `📅 Due: ${new Date(due_date).toLocaleString()}\n` : '') +
                  `⚡ Priority: ${priority}\n` +
                  `🆔 ${id}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `❌ Failed to add reminder: ${error.message}`
          }]
        };
      }
    }
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

async function updateBacklinks(
  storage: StorageService, 
  sourceId: string, 
  targetIds: string[]
): Promise<void> {
  // For each target note, add sourceId to its links array
  for (const targetId of targetIds) {
    const targetNote = await storage.getNote(targetId);
    if (targetNote && !targetNote.links.includes(sourceId)) {
      targetNote.links.push(sourceId);
      await storage.saveNote(targetNote);
    }
  }
}

async function fetchArticleContent(url: string): Promise<{
  title: string;
  markdown: string;
  author?: string;
  publishedDate?: string;
}> {
  // Implementation: Use @mozilla/readability or similar
  // Convert HTML to markdown
  throw new Error("Not implemented - use readability + turndown");
}

async function generateSummary(content: string): Promise<string> {
  // Implementation: Call LLM to summarize
  throw new Error("Not implemented - call LLM");
}

async function fetchYouTubeTranscript(videoId: string): Promise<any[]> {
  // Implementation: Use youtube-transcript or similar
  throw new Error("Not implemented - use youtube-transcript package");
}

async function fetchYouTubeMetadata(videoId: string): Promise<any> {
  // Implementation: Use YouTube Data API or scraping
  throw new Error("Not implemented");
}

function extractYouTubeVideoId(url: string): string {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
  if (!match) throw new Error("Invalid YouTube URL");
  return match[1];
}

function formatTranscript(transcript: any[], includeTimestamps: boolean): string {
  return transcript
    .map(item => 
      includeTimestamps 
        ? `[${formatTimestamp(item.offset)}] ${item.text}`
        : item.text
    )
    .join('\n\n');
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m ${secs}s`;
}

async function identifyChapters(content: string): Promise<any[]> {
  // Implementation: Use LLM to identify chapter breaks
  throw new Error("Not implemented - call LLM");
}

function formatWithChapters(content: string, chapters: any[]): string {
  // Implementation: Format transcript with chapter headings
  throw new Error("Not implemented");
}

// ============================================================================
// Export all tools
// ============================================================================

export function getAllTools(storage: StorageService): ToolDefinition[] {
  return [
    createNoteTool(storage),
    searchKnowledgeTool(storage),
    saveArticleTool(storage),
    saveYouTubeTool(storage),
    addReminderTool(storage),
    // Add more tools here...
  ];
}
