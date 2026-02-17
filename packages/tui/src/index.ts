import { createInterface } from 'node:readline';
import type { Logger } from 'pino';
import type { InterfaceAdapter } from '@echos/shared';
import type { AgentDeps } from '@echos/core';
import { createEchosAgent } from '@echos/core';

export interface TuiAdapterOptions {
  agentDeps: AgentDeps;
  logger: Logger;
}

export function createTuiAdapter(options: TuiAdapterOptions): InterfaceAdapter {
  const { agentDeps, logger } = options;
  let running = false;

  return {
    async start(): Promise<void> {
      running = true;
      const agent = createEchosAgent(agentDeps);

      const unsubscribe = agent.subscribe((event) => {
        if (event.type === 'message_update' && 'assistantMessageEvent' in event) {
          const ame = event.assistantMessageEvent;
          if (ame.type === 'text_delta') {
            process.stdout.write(ame.delta);
          }
        }
        if (event.type === 'tool_execution_start') {
          process.stdout.write(`\n[${event.toolName}] `);
        }
        if (event.type === 'agent_end') {
          process.stdout.write('\n\n');
        }
      });

      const rl = createInterface({ input: process.stdin, output: process.stdout });

      logger.info('TUI started');
      console.log('EchOS Terminal (type "exit" to quit)\n');

      const askQuestion = (): void => {
        if (!running) return;
        rl.question('> ', async (input) => {
          const trimmed = input.trim();
          if (trimmed === 'exit' || trimmed === 'quit') {
            unsubscribe();
            rl.close();
            running = false;
            return;
          }
          if (trimmed) {
            // Prepend current date/time context to the prompt
            const now = new Date();
            const contextualPrompt = `[Current date/time: ${now.toISOString()} (${now.toLocaleString('en-US', { timeZone: 'UTC' })} UTC)]\n\n${trimmed}`;
            await agent.prompt(contextualPrompt);
          }
          askQuestion();
        });
      };

      askQuestion();
    },

    async stop(): Promise<void> {
      running = false;
      logger.info('TUI stopped');
    },
  };
}
