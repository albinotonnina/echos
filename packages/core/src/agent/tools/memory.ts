import { Type, StringEnum, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { v4 as uuidv4 } from 'uuid';
import type { MemoryEntry } from '@echos/shared';
import type { SqliteStorage } from '../../storage/sqlite.js';

export interface MemoryToolDeps {
  sqlite: SqliteStorage;
}

// remember_about_me
const rememberSchema = Type.Object({
  subject: Type.String({ description: 'What this memory is about (e.g., "coffee", "work schedule")' }),
  content: Type.String({ description: 'The fact or preference to remember' }),
  kind: Type.Optional(
    StringEnum(['fact', 'person', 'project', 'expertise', 'preference'], {
      description: 'Memory category',
      default: 'fact',
    }),
  ),
  confidence: Type.Optional(
    Type.Number({ description: 'Confidence 0-1', default: 0.8, minimum: 0, maximum: 1 }),
  ),
});

type RememberParams = Static<typeof rememberSchema>;

export function rememberAboutMeTool(deps: MemoryToolDeps): AgentTool<typeof rememberSchema> {
  return {
    name: 'remember_about_me',
    label: 'Remember',
    description: 'Store a fact, preference, or detail about the user in long-term memory.',
    parameters: rememberSchema,
    execute: async (_toolCallId, params: RememberParams) => {
      const now = new Date().toISOString();
      const id = uuidv4();

      const entry: MemoryEntry = {
        id,
        kind: (params.kind ?? 'fact') as MemoryEntry['kind'],
        subject: params.subject,
        content: params.content,
        confidence: params.confidence ?? 0.8,
        source: 'conversation',
        created: now,
        updated: now,
      };

      deps.sqlite.upsertMemory(entry);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Remembered: "${params.subject}" — ${params.content}`,
          },
        ],
        details: { id, kind: entry.kind },
      };
    },
  };
}

// recall_knowledge
const recallSchema = Type.Object({
  topic: Type.String({ description: 'Topic to recall knowledge about' }),
});

type RecallParams = Static<typeof recallSchema>;

export function recallKnowledgeTool(deps: MemoryToolDeps): AgentTool<typeof recallSchema> {
  return {
    name: 'recall_knowledge',
    label: 'Recall',
    description:
      'Recall facts, preferences, or details about the user from long-term memory. Search with relevant keywords (e.g. topic="birthday", topic="coffee preference").',
    parameters: recallSchema,
    execute: async (_toolCallId, params: RecallParams) => {
      const memories = deps.sqlite.searchMemory(params.topic);

      if (memories.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No memories found about "${params.topic}".`,
            },
          ],
          details: { count: 0 },
        };
      }

      const formatted = memories
        .map(
          (m) =>
            `- **[${m.kind}]** ${m.subject}: ${m.content} (confidence: ${m.confidence.toFixed(1)})`,
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `Memories about "${params.topic}":\n\n${formatted}`,
          },
        ],
        details: { count: memories.length },
      };
    },
  };
}
