import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { SqliteStorage } from '../../storage/sqlite.js';

export interface SetAgentVoiceToolDeps {
  sqlite: SqliteStorage;
  /** Called immediately after the voice instruction is persisted so the
   *  caller can rebuild the system prompt mid-session via agent.setSystemPrompt(). */
  onVoiceChange: (instruction: string) => void;
}

const schema = Type.Object({
  instruction: Type.String({
    description:
      'The voice instruction to apply (1–3 sentences, imperative, second-person). ' +
      'Write a directive that YOU will follow going forward, e.g. ' +
      '"Be concise and direct. Skip preambles and filler phrases." ' +
      'Pass an empty string to reset to the default tone.',
  }),
});

type Params = Static<typeof schema>;

export function createSetAgentVoiceTool(deps: SetAgentVoiceToolDeps): AgentTool<typeof schema> {
  return {
    name: 'set_agent_voice',
    label: 'Set Voice',
    description: `Update how you communicate with the user.
Call this when the user asks you to change your tone, style, register, verbosity,
warmth, or personality. Interpret the request and write a concise instruction
(1–3 sentences, second-person, imperative) that you will follow going forward.
Examples:
  "Be concise and direct. Skip preambles and filler phrases."
  "Be warm and empathetic. Acknowledge feelings before jumping to answers."
  "Be playful and use light humour where appropriate."
Pass an empty string to reset to default behaviour.`,
    parameters: schema,
    execute: async (_toolCallId, params: Params) => {
      const instruction = params.instruction.trim();
      deps.sqlite.setAgentVoice(instruction);
      deps.onVoiceChange(instruction);

      if (!instruction) {
        return {
          content: [{ type: 'text' as const, text: 'Agent voice reset to default.' }],
          details: { reset: true },
        };
      }

      return {
        content: [{ type: 'text' as const, text: `Voice updated: "${instruction}"` }],
        details: { instruction },
      };
    },
  };
}
