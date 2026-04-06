/**
 * Dynamic tool selection based on user message intent.
 *
 * Categorizes the user message and selects only relevant tools to stay
 * under provider token limits (e.g. Groq free tier 8K TPM).
 *
 * Tool categories are defined by keyword/regex patterns. Each category
 * maps to a subset of the full tool list.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentTool = any;

export interface ToolCategory {
  name: string;
  keywords: RegExp[];
  toolNames: string[];
}

export const TOOL_CATEGORIES: ToolCategory[] = [
  {
    name: 'url_save',
    keywords: [
      /https?:\/\//i,
      /youtube\.com|youtu\.be/i,
      /twitter\.com|x\.com|vxtwitter/i,
      /article|blog|post|url|link/i,
    ],
    toolNames: ['save_article', 'save_youtube', 'save_tweet'],
  },
  {
    name: 'search_knowledge',
    keywords: [
      /\bwhat\s+(do|did)\s+(you|i)\s+know/i,
      /\bsearch\b/i,
      /\bfind\b/i,
      /\bhave\s+(you|i)\s+(saved|written|noted|recorded)\b/i,
      /\bshow\s+(me\s+)?(notes?|articles?|videos?|tweets?|entries?)\b/i,
      /\blist\s+(notes?|articles?|videos?|tweets?|entries?)\b/i,
      /\brecap\b/i,
      /\bsummary\s+of\s+(my|the)\b/i,
      /\bwhat\s+was\b/i,
      /\bwhat\s+is\b/i,
      /\bwhat\s+are\b/i,
      /\bwhat\s+have\b/i,
      /\btell\s+me\s+about\b/i,
      /\bremember\b/i,
      /\brecall\b/i,
    ],
    toolNames: [
      'search_knowledge',
      'list_notes',
      'get_note',
      'recall_knowledge',
      'explore_graph',
      'search_conversations',
    ],
  },
  {
    name: 'reminders',
    keywords: [
      /\breminder[s]?\b/i,
      /\bremind\s+me\b/i,
      /\balarm[s]?\b/i,
      /\bdue\s+(date|time)\b/i,
      /\bwhen\s+is\b/i,
    ],
    toolNames: ['add_reminder', 'list_reminders', 'complete_reminder'],
  },
  {
    name: 'todos',
    keywords: [
      /\btodo[s]?\b/i,
      /\btask[s]?\b/i,
      /\bto[-\s]?do[s]?\b/i,
      /\bi\s+need\s+to\b/i,
      /\bi\s+have\s+to\b/i,
      /\bi\s+should\b/i,
      /\bi\s+must\b/i,
      /\bremember\s+to\b/i,
      /\bdon't\s+forget\s+to\b/i,
      /\bmy\s+tasks\b/i,
      /\bmy\s+todos\b/i,
    ],
    toolNames: ['list_todos'],
  },
  {
    name: 'note_management',
    keywords: [
      /\bcreate\s+(a\s+)?note\b/i,
      /\bwrite\s+(a\s+)?note\b/i,
      /\bsave\s+(a\s+)?note\b/i,
      /\bupdate\s+(the\s+)?note\b/i,
      /\bedit\s+(the\s+)?note\b/i,
      /\bdelete\s+(the\s+)?note\b/i,
      /\btrash\b/i,
      /\brestore\b/i,
      /\bnote\s+id\b/i,
      /\bnote\s+(by\s+)?id\b/i,
    ],
    toolNames: [
      'create_note',
      'get_note',
      'update_note',
      'delete_note',
      'restore_note',
      'list_trash',
      'note_history',
      'restore_version',
    ],
  },
  {
    name: 'tags',
    keywords: [/\btag\b/i, /\brename\s+tag\b/i, /\bmerge\s+tag\b/i, /\blist\s+tags\b/i],
    toolNames: ['manage_tags'],
  },
  {
    name: 'reading',
    keywords: [
      /\breading\s+(list|queue)\b/i,
      /\bwhat\s+should\s+i\s+read\b/i,
      /\bunread\b/i,
      /\breading\s+(stats?|progress|habits?)\b/i,
      /\bhow\s+many\s+(articles?|videos?|tweets?)\b/i,
      /\bmark\s+(as\s+)?read\b/i,
      /\bknowledge\s+(stats?|overview)\b/i,
      /\bhow\s+(much|many)\s+(storage|notes?|knowledge)\b/i,
    ],
    toolNames: ['reading_queue', 'reading_stats', 'knowledge_stats', 'mark_content'],
  },
  {
    name: 'memory',
    keywords: [
      /\bremember\s+(that|this|about)\b/i,
      /\bsave\s+(this\s+)?(conversation|chat|discussion)\b/i,
      /\bwhat\s+do\s+you\s+know\s+about\s+me\b/i,
      /\bwhat\s+do\s+you\s+remember\b/i,
      /\bforget\b/i,
    ],
    toolNames: ['remember_about_me', 'recall_knowledge', 'save_conversation'],
  },
  {
    name: 'voice',
    keywords: [
      /\bset\s+(my\s+)?(voice|tone|style)\b/i,
      /\bagent\s+voice\b/i,
      /\bcommunication\s+style\b/i,
    ],
    toolNames: ['set_agent_voice'],
  },
  {
    name: 'export',
    keywords: [/\bexport\b/i, /\bbackup\b/i, /\bmanage\s+backups\b/i],
    toolNames: ['export_notes', 'manage_backups'],
  },
  {
    name: 'categorize',
    keywords: [/\bcategorize\b/i, /\bsynthesize\b/i, /\btemplate\b/i],
    toolNames: ['categorize_note', 'synthesize_notes', 'use_template'],
  },
  {
    name: 'links',
    keywords: [
      /\blink\b/i,
      /\bconnect\b/i,
      /\bsuggest\s+link\b/i,
      /\bsimilar\b/i,
      /\bfind\s+similar\b/i,
    ],
    toolNames: ['link_notes', 'find_similar', 'suggest_links'],
  },
];

// Tools that are always available regardless of message content
const ALWAYS_AVAILABLE = [
  'create_note', 'add_reminder', 'list_todos', 'list_reminders',
  'search_knowledge', 'list_notes', 'get_note', 'recall_knowledge',
  'manage_tags', 'categorize_note', 'mark_content',
  'reading_queue', 'knowledge_stats', 'reading_stats',
  'save_conversation', 'search_conversations', 'link_notes',
];

/**
 * Select relevant tools based on user message content.
 *
 * Real tools average ~644 chars (~160 tokens) each.
 * Budget: 8,000 TPM - 1,024 max_completion - ~900 system - ~2,000 history = ~4,076 for tools
 * At ~160 tokens/tool → max **25 tools** fit with ~2K history room.
 *
 * Strategy:
 * 1. ALWAYS_AVAILABLE: 25 most essential tools (works for ANY language)
 * 2. English keyword matching: adds extra tools on top (capped at 30)
 */
export function selectToolsForMessage(
  allTools: AgentTool[],
  messageText: string,
  maxTools = 30,
): AgentTool[] {
  const messageLower = messageText.toLowerCase();
  const matchedToolNames = new Set<string>();

  // 25 Essential tools — covers notes, memory, reading, content saving, reminders, todos
  // Works for ANY language (Hebrew, Russian, Arabic, Chinese, etc.)
  const ALWAYS_AVAILABLE = [
    // Core note operations (4)
    'create_note',
    'search_knowledge',
    'get_note',
    'list_notes',
    // Note CRUD (4)
    'update_note',
    'delete_note',
    'restore_note',
    'list_trash',
    // Reminders & Todos (4)
    'add_reminder',
    'list_reminders',
    'complete_reminder',
    'list_todos',
    // Memory & Conversations (4)
    'remember_about_me',
    'recall_knowledge',
    'save_conversation',
    'search_conversations',
    // Reading & Stats (3)
    'reading_queue',
    'reading_stats',
    'knowledge_stats',
    // Organization (1)
    'manage_tags',
    // Content Saving (6)
    'save_article',
    'save_youtube',
    'save_tweet',
    'save_audio',
    'save_image',
    'save_pdf',
  ];

  for (const name of ALWAYS_AVAILABLE) {
    matchedToolNames.add(name);
  }

  // English keyword matching adds extra specialized tools (capped at maxTools)
  for (const category of TOOL_CATEGORIES) {
    for (const keyword of category.keywords) {
      if (keyword.test(messageLower)) {
        for (const name of category.toolNames) {
          matchedToolNames.add(name);
        }
        break;
      }
    }
  }

  // Filter tools from the full list
  const selected = allTools.filter((tool) => matchedToolNames.has(tool.name));

  // Cap at maxTools
  if (selected.length > maxTools) {
    return selected.slice(0, maxTools);
  }

  return selected;
}
