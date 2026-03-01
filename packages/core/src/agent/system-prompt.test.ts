import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT, buildSystemPrompt } from './system-prompt.js';
import { createNoteTool, type CreateNoteToolDeps } from './tools/create-note.js';
import { searchKnowledgeTool, type SearchKnowledgeToolDeps } from './tools/search-knowledge.js';
import { listNotesTool, type ListNotesToolDeps } from './tools/list-notes.js';
import { deleteNoteTool, type DeleteNoteToolDeps } from './tools/delete-note.js';
import { addReminderTool, completeReminderTool, type ReminderToolDeps } from './tools/reminder.js';
import { listTodosTool, type ListTodosToolDeps } from './tools/list-todos.js';
import { listRemindersTool, type ListRemindersToolDeps } from './tools/list-reminders.js';
import {
  createCategorizeNoteTool,
  type CategorizeNoteToolDeps,
} from './tools/categorize-note.js';
import { recallKnowledgeTool, type MemoryToolDeps } from './tools/memory.js';

// Minimal stubs — we only inspect the description property, never call execute
const stubDeps = {} as CreateNoteToolDeps &
  SearchKnowledgeToolDeps &
  ListNotesToolDeps &
  DeleteNoteToolDeps &
  ReminderToolDeps &
  ListTodosToolDeps &
  ListRemindersToolDeps &
  CategorizeNoteToolDeps &
  MemoryToolDeps;

describe('SYSTEM_PROMPT', () => {
  it('contains cross-cutting sections that must stay in the prompt', () => {
    expect(SYSTEM_PROMPT).toContain('## Current Date and Time');
    expect(SYSTEM_PROMPT).toContain('## Content Status (IMPORTANT)');
    expect(SYSTEM_PROMPT).toContain('### Auto-detect todos (IMPORTANT)');
    expect(SYSTEM_PROMPT).toContain('## Formatting');
  });

  it('references tweets in content status section', () => {
    expect(SYSTEM_PROMPT).toContain('tweets');
    expect(SYSTEM_PROMPT).toContain('article, tweet, or YouTube video');
    expect(SYSTEM_PROMPT).toContain('article or tweet');
    expect(SYSTEM_PROMPT).toContain('article/tweet');
  });

  it('contains URL routing rules for specialized tools', () => {
    expect(SYSTEM_PROMPT).toContain('## URL Routing (IMPORTANT)');
    expect(SYSTEM_PROMPT).toContain('save_tweet');
    expect(SYSTEM_PROMPT).toContain('save_youtube');
    expect(SYSTEM_PROMPT).toContain('save_article');
    expect(SYSTEM_PROMPT).toContain('x.com');
    expect(SYSTEM_PROMPT).toContain('twitter.com');
  });

  it('enforces factual retrieval for exact saved details', () => {
    expect(SYSTEM_PROMPT).toContain('## Factual Retrieval (CRITICAL)');
    expect(SYSTEM_PROMPT).toContain('call **get_note**');
    expect(SYSTEM_PROMPT).toContain('Never invent or guess URLs/IDs');
  });

  it('enforces searching before answering personal queries', () => {
    expect(SYSTEM_PROMPT).toContain('## Personal Queries — Always Search First (CRITICAL)');
    expect(SYSTEM_PROMPT).toContain('never skip the search step');
    expect(SYSTEM_PROMPT).toContain('**list_notes**');
    expect(SYSTEM_PROMPT).toContain('**search_knowledge**');
  });

  it('does not contain sections moved to tool descriptions', () => {
    expect(SYSTEM_PROMPT).not.toContain('## Capabilities');
    expect(SYSTEM_PROMPT).not.toContain('## Tool Usage');
    expect(SYSTEM_PROMPT).not.toContain('## Voice Messages');
    expect(SYSTEM_PROMPT).not.toContain('## Journal Entries');
    expect(SYSTEM_PROMPT).not.toContain('## Categorization');
  });
});

describe('buildSystemPrompt', () => {
  it('appends voice section when agentVoice is provided', () => {
    const result = buildSystemPrompt([], false, 'Speak like a pirate');
    expect(result).toContain('## Communication Style');
    expect(result).toContain('Speak like a pirate');
  });

  it('appends memory section when memories are provided', () => {
    const result = buildSystemPrompt(
      [
        {
          id: '1',
          kind: 'fact',
          subject: 'coffee',
          content: 'likes espresso',
          confidence: 0.9,
          source: 'conversation',
          created: '',
          updated: '',
        },
      ],
      false,
    );
    expect(result).toContain('## Known Facts About the User');
    expect(result).toContain('[fact] coffee: likes espresso');
  });
});

describe('tool descriptions contain moved instructions', () => {
  it('create_note: categorize after creating, voice, journal guidance, excludes URLs', () => {
    const desc = createNoteTool(stubDeps).description;
    expect(desc).toContain('categorize_note');
    expect(desc).toContain('inputSource="voice"');
    expect(desc).toContain('type="journal"');
    expect(desc).toContain('Do NOT use for URLs');
  });

  it('search_knowledge: covers all content types and hybrid search', () => {
    const desc = searchKnowledgeTool(stubDeps).description;
    expect(desc).toContain('hybrid search');
    expect(desc).toContain('journals');
    expect(desc).toContain('reminders');
    expect(desc).toContain('YouTube');
  });

  it('list_notes: date normalization and status guidance', () => {
    const desc = listNotesTool(stubDeps).description;
    expect(desc).toContain('ISO 8601');
    expect(desc).toContain('status="saved"');
    expect(desc).toContain('status="read"');
  });

  it('delete_note: confirm before deleting', () => {
    const desc = deleteNoteTool(stubDeps).description;
    expect(desc).toContain('confirm with the user');
  });

  it('add_reminder: todo vs reminder routing', () => {
    const desc = addReminderTool(stubDeps).description;
    expect(desc).toContain('kind="todo"');
    expect(desc).toContain('kind="reminder"');
  });

  it('complete_reminder: works for both kinds', () => {
    const desc = completeReminderTool(stubDeps).description;
    expect(desc).toContain('kind="todo"');
    expect(desc).toContain('kind="reminder"');
  });

  it('list_todos: only todos, cross-references list_reminders', () => {
    const desc = listTodosTool(stubDeps).description;
    expect(desc).toContain('ONLY todos');
    expect(desc).toContain('list_reminders');
  });

  it('list_reminders: only reminders, cross-references list_todos', () => {
    const desc = listRemindersTool(stubDeps).description;
    expect(desc).toContain('kind="reminder"');
    expect(desc).toContain('list_todos');
  });

  it('categorize_note: preferred after create_note, mode guidance', () => {
    const desc = createCategorizeNoteTool(stubDeps as CategorizeNoteToolDeps).description;
    expect(desc).toContain('after create_note');
    expect(desc).toContain('"lightweight"');
    expect(desc).toContain('"full"');
  });

  it('recall_knowledge: keyword search examples', () => {
    const desc = recallKnowledgeTool(stubDeps).description;
    expect(desc).toContain('topic="birthday"');
    expect(desc).toContain('topic="coffee preference"');
  });
});
