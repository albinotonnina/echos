import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import matter from 'gray-matter';

export interface Template {
  name: string;
  description: string;
  category: string;
  tags: string[];
  content: string;
  filePath: string;
}

interface TemplateFrontmatter {
  name?: string;
  description?: string;
  category?: string;
  tags?: string[];
}

function templatesDir(knowledgeDir: string): string {
  return join(knowledgeDir, 'templates');
}

function ensureTemplatesDir(knowledgeDir: string): string {
  const dir = templatesDir(knowledgeDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function listTemplates(knowledgeDir: string): Template[] {
  const dir = templatesDir(knowledgeDir);
  if (!existsSync(dir)) {
    return [];
  }

  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  const templates: Template[] = [];

  for (const file of files) {
    const filePath = join(dir, file);
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = matter(raw);
    const fm = parsed.data as TemplateFrontmatter;
    const slug = basename(file, '.md');

    templates.push({
      name: fm.name ?? slug,
      description: fm.description ?? '',
      category: fm.category ?? 'general',
      tags: fm.tags ?? [],
      content: parsed.content.trim(),
      filePath,
    });
  }

  return templates;
}

export function getTemplate(knowledgeDir: string, name: string): Template | undefined {
  const templates = listTemplates(knowledgeDir);
  return templates.find(
    (t) =>
      t.name.toLowerCase() === name.toLowerCase() ||
      basename(t.filePath, '.md').toLowerCase() === name.toLowerCase(),
  );
}

export function applyTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

const BUILT_IN_TEMPLATES: Array<{ fileName: string; frontmatter: TemplateFrontmatter; content: string }> = [
  {
    fileName: 'meeting-notes.md',
    frontmatter: {
      name: 'Meeting Notes',
      description: 'Template for capturing meeting notes with attendees, agenda, and action items',
      category: 'work',
      tags: ['meeting', 'notes'],
    },
    content: `# {{title}}

**Date:** {{date}}
**Attendees:** {{attendees}}

## Agenda

-

## Discussion Notes



## Action Items

- [ ]

## Follow-up

`,
  },
  {
    fileName: 'book-review.md',
    frontmatter: {
      name: 'Book Review',
      description: 'Template for reviewing a book with key takeaways and rating',
      category: 'reading',
      tags: ['book', 'review'],
    },
    content: `# {{title}}

**Author:** {{author}}
**Rating:** /5

## Summary



## Key Takeaways

1.
2.
3.

## Favorite Quotes

>

## How It Changed My Thinking

`,
  },
  {
    fileName: 'project-brief.md',
    frontmatter: {
      name: 'Project Brief',
      description: 'Template for defining a new project with goals, scope, and timeline',
      category: 'work',
      tags: ['project', 'planning'],
    },
    content: `# {{title}}

**Start Date:** {{date}}
**Status:** Planning

## Objective



## Scope

### In Scope

-

### Out of Scope

-

## Key Milestones

1.

## Resources

-

## Risks

-

## Success Criteria

-
`,
  },
  {
    fileName: 'weekly-review.md',
    frontmatter: {
      name: 'Weekly Review',
      description: 'Template for a weekly review of accomplishments, learnings, and plans',
      category: 'personal',
      tags: ['review', 'weekly', 'reflection'],
    },
    content: `# Weekly Review — {{date}}

## Accomplishments

-

## Challenges

-

## Learnings

-

## Next Week's Priorities

1.
2.
3.

## Gratitude

-
`,
  },
  {
    fileName: 'decision-log.md',
    frontmatter: {
      name: 'Decision Log',
      description: 'Template for documenting an important decision with context and alternatives',
      category: 'work',
      tags: ['decision', 'log'],
    },
    content: `# Decision: {{title}}

**Date:** {{date}}
**Status:** {{status}}

## Context



## Options Considered

### Option 1:

**Pros:**
-

**Cons:**
-

### Option 2:

**Pros:**
-

**Cons:**
-

## Decision



## Rationale



## Consequences

-
`,
  },
];

export function createDefaultTemplates(knowledgeDir: string): number {
  const dir = ensureTemplatesDir(knowledgeDir);
  let created = 0;

  for (const tmpl of BUILT_IN_TEMPLATES) {
    const filePath = join(dir, tmpl.fileName);
    if (!existsSync(filePath)) {
      const fileContent = matter.stringify(tmpl.content, tmpl.frontmatter);
      writeFileSync(filePath, fileContent, 'utf-8');
      created++;
    }
  }

  return created;
}

export function saveCustomTemplate(
  knowledgeDir: string,
  name: string,
  description: string,
  content: string,
  category?: string,
  tags?: string[],
): string {
  const dir = ensureTemplatesDir(knowledgeDir);
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  const filePath = join(dir, `${slug}.md`);

  const frontmatter: TemplateFrontmatter = {
    name,
    description,
    category: category ?? 'custom',
    tags: tags ?? [],
  };

  const fileContent = matter.stringify(content, frontmatter);
  writeFileSync(filePath, fileContent, 'utf-8');

  return filePath;
}
