import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createLogger } from '@echos/shared';
import { createSqliteStorage, type SqliteStorage } from '../../storage/sqlite.js';
import { createSetAgentVoiceTool } from './set-agent-voice.js';
import { buildSystemPrompt } from '../system-prompt.js';

const logger = createLogger('test', 'silent');

let tempDir: string;
let sqlite: SqliteStorage;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'echos-voice-test-'));
  sqlite = createSqliteStorage(join(tempDir, 'test.db'), logger);
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('set_agent_voice tool', () => {
  it('persists a voice instruction to storage', async () => {
    const onVoiceChange = vi.fn();
    const tool = createSetAgentVoiceTool({ sqlite, onVoiceChange });

    await tool.execute('call-1', { instruction: 'Be concise and direct.' });

    expect(sqlite.getAgentVoice()).toBe('Be concise and direct.');
  });

  it('calls onVoiceChange with the instruction', async () => {
    const onVoiceChange = vi.fn();
    const tool = createSetAgentVoiceTool({ sqlite, onVoiceChange });

    await tool.execute('call-1', { instruction: 'Be warm and empathetic.' });

    expect(onVoiceChange).toHaveBeenCalledOnce();
    expect(onVoiceChange).toHaveBeenCalledWith('Be warm and empathetic.');
  });

  it('resets the voice when passed an empty string', async () => {
    const onVoiceChange = vi.fn();
    const tool = createSetAgentVoiceTool({ sqlite, onVoiceChange });

    // Set a voice first
    await tool.execute('call-1', { instruction: 'Be serious.' });
    expect(sqlite.getAgentVoice()).toBe('Be serious.');

    // Reset it
    await tool.execute('call-2', { instruction: '' });
    expect(sqlite.getAgentVoice()).toBe('');
    expect(onVoiceChange).toHaveBeenLastCalledWith('');
  });

  it('trims whitespace from the instruction', async () => {
    const onVoiceChange = vi.fn();
    const tool = createSetAgentVoiceTool({ sqlite, onVoiceChange });

    await tool.execute('call-1', { instruction: '  Be brief.  ' });

    expect(sqlite.getAgentVoice()).toBe('Be brief.');
    expect(onVoiceChange).toHaveBeenCalledWith('Be brief.');
  });

  it('returns a confirmation message on set', async () => {
    const tool = createSetAgentVoiceTool({ sqlite, onVoiceChange: vi.fn() });
    const result = await tool.execute('call-1', { instruction: 'Be playful.' });

    const first = result.content[0] as { type: string; text: string } | undefined;
    expect(first?.type).toBe('text');
    expect(first?.text).toContain('Voice updated');
  });

  it('returns a reset confirmation on empty string', async () => {
    const tool = createSetAgentVoiceTool({ sqlite, onVoiceChange: vi.fn() });
    const result = await tool.execute('call-1', { instruction: '' });

    expect((result.content[0] as { type: string; text: string }).text).toContain('reset');
  });
});

describe('getAgentVoice / setAgentVoice storage', () => {
  it('returns null when no voice has been set', () => {
    expect(sqlite.getAgentVoice()).toBeNull();
  });

  it('persists and retrieves the voice instruction', () => {
    sqlite.setAgentVoice('Be concise.');
    expect(sqlite.getAgentVoice()).toBe('Be concise.');
  });

  it('overwrites an existing voice instruction', () => {
    sqlite.setAgentVoice('Be formal.');
    sqlite.setAgentVoice('Be casual.');
    expect(sqlite.getAgentVoice()).toBe('Be casual.');
  });
});

describe('buildSystemPrompt with agentVoice', () => {
  it('injects a Communication Style section when voice is set', () => {
    const prompt = buildSystemPrompt([], false, 'Be concise and direct.');
    expect(prompt).toContain('## Communication Style');
    expect(prompt).toContain('Be concise and direct.');
  });

  it('omits the Communication Style section when voice is null', () => {
    const prompt = buildSystemPrompt([], false, null);
    expect(prompt).not.toContain('## Communication Style');
  });

  it('omits the Communication Style section when voice is undefined', () => {
    const prompt = buildSystemPrompt([], false);
    expect(prompt).not.toContain('## Communication Style');
  });

  it('injects voice alongside memories', () => {
    const memories = [
      {
        id: '1',
        kind: 'fact' as const,
        subject: 'name',
        content: 'Alice',
        confidence: 0.9,
        source: 'conversation',
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
      },
    ];
    const prompt = buildSystemPrompt(memories, false, 'Be warm.');
    expect(prompt).toContain('## Communication Style');
    expect(prompt).toContain('Be warm.');
    expect(prompt).toContain('## Known Facts About the User');
    expect(prompt).toContain('Alice');
  });
});
