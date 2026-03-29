import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createLogger } from '@echos/shared';
import { ValidationError } from '@echos/shared';
import { createSqliteStorage, type SqliteStorage } from '../../storage/sqlite.js';
import { createMarkdownStorage, type MarkdownStorage } from '../../storage/markdown.js';
import { createUseTemplateTool, type UseTemplateToolDeps } from './use-template.js';
import matter from 'gray-matter';

const logger = createLogger('test', 'silent');

let tempDir: string;
let sqlite: SqliteStorage;
let markdown: MarkdownStorage;
let knowledgeDir: string;

const mockVectorDb = {
  upsert: async () => {},
  search: async () => [],
  findByVector: async () => [],
  remove: async () => {},
  close: () => {},
};

const stubEmbedding = async () => new Array(1536).fill(0);

function makeDeps(): UseTemplateToolDeps {
  return {
    sqlite,
    markdown,
    vectorDb: mockVectorDb,
    generateEmbedding: stubEmbedding,
    knowledgeDir,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'echos-template-test-'));
  knowledgeDir = join(tempDir, 'knowledge');
  mkdirSync(knowledgeDir, { recursive: true });
  sqlite = createSqliteStorage(join(tempDir, 'test.db'), logger);
  markdown = createMarkdownStorage(knowledgeDir, logger);
});

afterEach(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('use_template tool', () => {
  describe('list action', () => {
    it('should scaffold default templates and list them', async () => {
      const tool = createUseTemplateTool(makeDeps());
      const result = await tool.execute('tc1', { action: 'list' });
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Available templates');
      expect(text).toContain('Meeting Notes');
      expect(text).toContain('Book Review');

      const details = result.details as { templates: Array<{ name: string }> };
      expect(details.templates.length).toBeGreaterThanOrEqual(5);
    });

    it('should return empty when no templates dir exists and scaffolding is done', async () => {
      // Default templates will be created, so we expect at least 5
      const tool = createUseTemplateTool(makeDeps());
      const result = await tool.execute('tc2', { action: 'list' });
      const details = result.details as { templates: Array<{ name: string }> };
      expect(details.templates.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('use action', () => {
    it('should throw ValidationError when templateName is missing', async () => {
      const tool = createUseTemplateTool(makeDeps());
      await expect(tool.execute('tc3', { action: 'use' })).rejects.toThrow(ValidationError);
    });

    it('should return error when template not found', async () => {
      const tool = createUseTemplateTool(makeDeps());
      const result = await tool.execute('tc4', {
        action: 'use',
        templateName: 'nonexistent',
      });
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('not found');
    });

    it('should create a note from a built-in template', async () => {
      const tool = createUseTemplateTool(makeDeps());
      const result = await tool.execute('tc5', {
        action: 'use',
        templateName: 'Meeting Notes',
        title: 'Sprint Planning',
        variables: { date: '2024-01-15', attendees: 'Alice, Bob' },
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Created note "Sprint Planning"');

      const details = result.details as { id: string; templateUsed: string };
      expect(details.templateUsed).toBe('Meeting Notes');

      const row = sqlite.getNote(details.id);
      expect(row).toBeDefined();
      expect(row!.title).toBe('Sprint Planning');
    });

    it('should inject params.title into template variables for {{title}} placeholder', async () => {
      const tool = createUseTemplateTool(makeDeps());
      const result = await tool.execute('tc6', {
        action: 'use',
        templateName: 'Meeting Notes',
        title: 'My Meeting Title',
        variables: { date: '2024-01-15', attendees: 'Alice' },
      });

      const details = result.details as { id: string };
      const note = markdown.readById(details.id);
      expect(note).toBeDefined();
      // The content should have the title substituted, not {{title}}
      expect(note!.content).toContain('# My Meeting Title');
      expect(note!.content).not.toContain('{{title}}');
    });

    it('should prefer variables.title over params.title for placeholder substitution', async () => {
      const tool = createUseTemplateTool(makeDeps());
      const result = await tool.execute('tc7', {
        action: 'use',
        templateName: 'Meeting Notes',
        title: 'Param Title',
        variables: { title: 'Variable Title', date: '2024-01-15', attendees: 'Alice' },
      });

      const details = result.details as { id: string };
      const note = markdown.readById(details.id);
      expect(note!.content).toContain('# Variable Title');
    });
  });

  describe('create action', () => {
    it('should throw ValidationError when title is missing', async () => {
      const tool = createUseTemplateTool(makeDeps());
      await expect(
        tool.execute('tc8', { action: 'create', content: 'some content' }),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError when content is missing', async () => {
      const tool = createUseTemplateTool(makeDeps());
      await expect(
        tool.execute('tc9', { action: 'create', title: 'My Template' }),
      ).rejects.toThrow(ValidationError);
    });

    it('should save a custom template', async () => {
      const tool = createUseTemplateTool(makeDeps());
      const result = await tool.execute('tc10', {
        action: 'create',
        title: 'Custom Template',
        content: '# {{title}}\n\nNotes: {{notes}}',
        description: 'A test template',
        category: 'testing',
        tags: ['test'],
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Created custom template "Custom Template"');

      // Verify the template can be listed
      const listResult = await tool.execute('tc11', { action: 'list' });
      const listText = (listResult.content[0] as { type: 'text'; text: string }).text;
      expect(listText).toContain('Custom Template');
    });

    it('should create then use a custom template', async () => {
      const tool = createUseTemplateTool(makeDeps());
      await tool.execute('tc12', {
        action: 'create',
        title: 'Standup',
        content: '# {{title}}\n\nDone: {{done}}\nTodo: {{todo}}',
      });

      const result = await tool.execute('tc13', {
        action: 'use',
        templateName: 'Standup',
        title: 'Monday Standup',
        variables: { done: 'Fixed bugs', todo: 'Write tests' },
      });

      const details = result.details as { id: string };
      const note = markdown.readById(details.id);
      expect(note!.content).toContain('Done: Fixed bugs');
      expect(note!.content).toContain('Todo: Write tests');
    });
  });

  describe('unknown action', () => {
    it('should throw ValidationError for unknown action', async () => {
      const tool = createUseTemplateTool(makeDeps());
      await expect(
        tool.execute('tc14', { action: 'delete' as any }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('malformed template files', () => {
    it('should skip malformed files and still list valid ones', async () => {
      const tool = createUseTemplateTool(makeDeps());
      // Scaffold defaults first
      await tool.execute('tc15', { action: 'list' });

      // Write a malformed file
      const templatesPath = join(knowledgeDir, 'templates');
      writeFileSync(join(templatesPath, 'broken.md'), '\x00\x01\x02invalid binary', 'utf-8');

      const result = await tool.execute('tc16', { action: 'list' });
      const details = result.details as { templates: Array<{ name: string }> };
      // Should still have the 5 built-in templates
      expect(details.templates.length).toBeGreaterThanOrEqual(5);
    });

    it('should handle tags that are not arrays in frontmatter', async () => {
      const tool = createUseTemplateTool(makeDeps());
      await tool.execute('tc17', { action: 'list' });

      const templatesPath = join(knowledgeDir, 'templates');
      const content = matter.stringify('# Test', { name: 'Bad Tags', tags: 'not-an-array' as any });
      writeFileSync(join(templatesPath, 'bad-tags.md'), content, 'utf-8');

      const result = await tool.execute('tc18', { action: 'list' });
      const details = result.details as { templates: Array<{ name: string; tags: string[] }> };
      const badTagsTemplate = details.templates.find((t) => t.name === 'Bad Tags');
      expect(badTagsTemplate).toBeDefined();
      expect(Array.isArray(badTagsTemplate!.tags)).toBe(true);
    });
  });
});
