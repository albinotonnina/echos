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
 * Real tools average ~644 chars each. With 48 tools, total is ~30,900 chars (~7,725 tokens)
 * plus system prompt (~900) plus max_completion (5,000) = ~13,625 TPM → exceeds 8K limit.
 *
 * Budget: 8,000 TPM - 5,000 max_completion - ~900 system = ~2,100 tokens for tools
 * At ~160 tokens/tool average → max **13 tools** fit.
 *
 * Strategy:
 * 1. ALWAYS_AVAILABLE: 13 most essential tools (works for ANY language)
 * 2. English keyword matching: adds extra tools on top if message is in English
 * 3. Cap at 15 total to stay safe
 */
export function selectToolsForMessage(
  allTools: AgentTool[],
  messageText: string,
  maxTools = 15,
): AgentTool[] {
  const messageLower = messageText.toLowerCase();
  const matchedToolNames = new Set<string>();

  // Essential tools available for ANY language (13 tools = ~2,080 tokens)
  // Covers: notes, search, reminders, todos, memory, tags, reading
  const ALWAYS_AVAILABLE = [
    'create_note',       // Create notes
    'search_knowledge',  // Search knowledge base
    'get_note',          // Get note by ID
    'list_notes',        // List notes
    'add_reminder',      // Add reminders/todos
    'list_reminders',    // View reminders
    'complete_reminder', // Mark done
    'list_todos',        // View todos
    'remember_about_me', // Save facts to memory
    'recall_knowledge',  // Search memory
    'manage_tags',       // Tag management
    'categorize_note',   // Auto-categorize
    'mark_content',      // Mark as read/saved
  ];

  for (const name of ALWAYS_AVAILABLE) {
    matchedToolNames.add(name);
  }

  // English keyword matching adds extra tools (capped at maxTools)
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
