import { Type, StringEnum, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { v4 as uuidv4 } from 'uuid';
import type { NoteMetadata, ContentType, InputSource } from '@echos/shared';
import { validateContentSize, ValidationError } from '@echos/shared';
import type { SqliteStorage } from '../../storage/sqlite.js';
import type { MarkdownStorage } from '../../storage/markdown.js';
import type { VectorStorage } from '../../storage/vectordb.js';
import {
  listTemplates,
  getTemplate,
  applyTemplate,
  createDefaultTemplates,
  saveCustomTemplate,
} from '../../templates/index.js';

export interface UseTemplateToolDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
  vectorDb: VectorStorage;
  generateEmbedding: (text: string) => Promise<number[]>;
  knowledgeDir: string;
}

const schema = Type.Object({
  action: StringEnum(['list', 'use', 'create'], {
    description: 'Action: "list" to show templates, "use" to create a note from a template, "create" to save a new custom template',
  }),
  templateName: Type.Optional(
    Type.String({ description: 'Name of the template (for "use" action)' }),
  ),
  variables: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description: 'Variables to fill in template placeholders like {{title}}, {{date}} (for "use" action)',
    }),
  ),
  title: Type.Optional(
    Type.String({ description: 'Title for the new note (for "use" action) or new template name (for "create" action)' }),
  ),
  description: Type.Optional(
    Type.String({ description: 'Description of the new template (for "create" action)' }),
  ),
  content: Type.Optional(
    Type.String({ description: 'Content of the new template with {{placeholder}} variables (for "create" action)' }),
  ),
  category: Type.Optional(
    Type.String({ description: 'Category for the new template (for "create" action)' }),
  ),
  tags: Type.Optional(
    Type.Array(Type.String(), { description: 'Tags for the new template (for "create" action)' }),
  ),
});

type Params = Static<typeof schema>;

export function createUseTemplateTool(deps: UseTemplateToolDeps): AgentTool<typeof schema> {
  return {
    name: 'use_template',
    label: 'Use Template',
    description:
      'Manage and use note templates. Use action="list" to show available templates, action="use" to create a note from a template (provide templateName and optional variables), action="create" to save a new custom template. Built-in templates are scaffolded automatically on first use.',
    parameters: schema,
    execute: async (_toolCallId: string, params: Params) => {
      // Ensure default templates exist on any action
      createDefaultTemplates(deps.knowledgeDir);

      if (params.action === 'list') {
        const templates = listTemplates(deps.knowledgeDir);
        if (templates.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No templates found.' }],
            details: { templates: [] },
          };
        }

        const listing = templates
          .map((t) => `- **${t.name}** (${t.category}): ${t.description}`)
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `Available templates:\n${listing}`,
            },
          ],
          details: {
            templates: templates.map((t) => ({
              name: t.name,
              description: t.description,
              category: t.category,
              tags: t.tags,
            })),
          },
        };
      }

      if (params.action === 'use') {
        if (!params.templateName) {
          throw new ValidationError('use action requires a "templateName" parameter');
        }

        const template = getTemplate(deps.knowledgeDir, params.templateName);
        if (!template) {
          const available = listTemplates(deps.knowledgeDir).map((t) => t.name);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Template "${params.templateName}" not found. Available: ${available.join(', ')}`,
              },
            ],
            details: { available },
          };
        }

        const variables: Record<string, string> = { ...(params.variables ?? {}) };
        if (params.title && !variables['title']) {
          variables['title'] = params.title;
        }
        const noteContent = applyTemplate(template.content, variables);
        const noteTitle = variables['title'] ?? params.title ?? template.name;

        validateContentSize(noteContent, { label: 'template note content' });

        const now = new Date().toISOString();
        const id = uuidv4();
        const type: ContentType = 'note';

        const metadata: NoteMetadata = {
          id,
          type,
          title: noteTitle,
          created: now,
          updated: now,
          tags: template.tags,
          links: [],
          category: template.category,
          status: 'read',
          inputSource: 'text' as InputSource,
        };

        const filePath = deps.markdown.save(metadata, noteContent);
        deps.sqlite.upsertNote(metadata, noteContent, filePath);

        const embedText = `${noteTitle}\n\n${noteContent}`;
        try {
          const vector = await deps.generateEmbedding(embedText);
          await deps.vectorDb.upsert({ id, text: embedText, vector, type, title: noteTitle });
        } catch {
          // Embedding failure is non-fatal
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Created note "${noteTitle}" (id: ${id}) from template "${template.name}".`,
            },
          ],
          details: { id, filePath, type, templateUsed: template.name },
        };
      }

      if (params.action === 'create') {
        if (!params.title) {
          throw new ValidationError('create action requires a "title" parameter');
        }
        if (!params.content) {
          throw new ValidationError('create action requires a "content" parameter');
        }

        validateContentSize(params.content, { label: 'template content' });

        const filePath = saveCustomTemplate(
          deps.knowledgeDir,
          params.title,
          params.description ?? '',
          params.content,
          params.category,
          params.tags,
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: `Created custom template "${params.title}" at ${filePath}.`,
            },
          ],
          details: { name: params.title, filePath },
        };
      }

      throw new ValidationError(`Unknown action: ${String(params.action)}. Use "list", "use", or "create".`);
    },
  };
}
