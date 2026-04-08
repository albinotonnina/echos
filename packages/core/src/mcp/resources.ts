import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SqliteStorage } from '../storage/sqlite.js';
import type { MarkdownStorage } from '../storage/markdown.js';

export interface ResourceProviderDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
}

function formatNoteMarkdown(
  id: string,
  title: string,
  type: string,
  category: string,
  tagsRaw: string,
  created: string,
  updated: string,
  sourceUrl: string | null,
  author: string | null,
  content: string,
): string {
  const tags = tagsRaw.split(',').filter(Boolean).map((t) => `"${t.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  const lines = [
    '---',
    `id: ${id}`,
    `title: "${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    `type: ${type}`,
    `category: ${category}`,
    `tags: [${tags.join(', ')}]`,
    `created: ${created}`,
    `updated: ${updated}`,
  ];
  if (sourceUrl) lines.push(`source: ${sourceUrl}`);
  if (author) lines.push(`author: ${author}`);
  lines.push('---', '', content);
  return lines.join('\n');
}

function toStr(v: string | string[]): string {
  return Array.isArray(v) ? v[0] ?? '' : v;
}

export function registerResources(server: McpServer, deps: ResourceProviderDeps): void {
  // notes://{noteId} — browse and read individual notes
  server.registerResource(
    'notes',
    new ResourceTemplate('notes://{noteId}', {
      list: async () => {
        const rows = deps.sqlite.listNotes({ limit: 1000 });
        return {
          resources: rows.map((row) => ({
            uri: `notes://${row.id}`,
            name: row.title,
            mimeType: 'text/markdown',
            ...(row.gist ? { description: row.gist } : {}),
          })),
        };
      },
    }),
    { mimeType: 'text/markdown' },
    async (uri, variables) => {
      const noteId = toStr(variables['noteId'] ?? '');
      const row = deps.sqlite.getNote(noteId);
      if (!row) {
        return {
          contents: [{ uri: uri.toString(), text: `Note not found: ${noteId}`, mimeType: 'text/plain' }],
        };
      }
      const noteFile = deps.markdown.read(row.filePath);
      const content = noteFile?.content ?? row.content;
      const text = formatNoteMarkdown(
        row.id, row.title, row.type, row.category,
        row.tags, row.created, row.updated,
        row.sourceUrl, row.author, content,
      );
      return {
        contents: [{ uri: uri.toString(), text, mimeType: 'text/markdown' }],
      };
    },
  );

  // tags://{tagName} — browse all tags, read notes by tag
  server.registerResource(
    'tags',
    new ResourceTemplate('tags://{tagName}', {
      list: async () => {
        const tagRows = deps.sqlite.getTopTagsWithCounts(500);
        return {
          resources: tagRows.map(({ tag, count }) => ({
            uri: `tags://${encodeURIComponent(tag)}`,
            name: tag,
            description: `${count} note${count !== 1 ? 's' : ''}`,
          })),
        };
      },
    }),
    {},
    async (uri, variables) => {
      const tagName = decodeURIComponent(toStr(variables['tagName'] ?? ''));
      const rows = deps.sqlite.listNotes({ tags: [tagName], limit: 500 });
      const body =
        rows.length === 0
          ? `No notes found with tag: ${tagName}`
          : rows
              .map((row) => `- [${row.title}](notes://${row.id}) (${row.type}, ${row.created.slice(0, 10)})`)
              .join('\n');
      return {
        contents: [
          {
            uri: uri.toString(),
            text: `# Notes tagged "${tagName}"\n\n${body}`,
            mimeType: 'text/markdown',
          },
        ],
      };
    },
  );

  // categories://{categoryName} — browse all categories, read notes by category
  server.registerResource(
    'categories',
    new ResourceTemplate('categories://{categoryName}', {
      list: async () => {
        const catRows = deps.sqlite.getCategoryFrequencies(200);
        return {
          resources: catRows.map(({ category, count }) => ({
            uri: `categories://${encodeURIComponent(category)}`,
            name: category,
            description: `${count} note${count !== 1 ? 's' : ''}`,
          })),
        };
      },
    }),
    {},
    async (uri, variables) => {
      const categoryName = decodeURIComponent(toStr(variables['categoryName'] ?? ''));
      const rows = deps.sqlite.listNotes({ category: categoryName, limit: 500 });
      const body =
        rows.length === 0
          ? `No notes found in category: ${categoryName}`
          : rows
              .map((row) => `- [${row.title}](notes://${row.id}) (${row.type}, ${row.created.slice(0, 10)})`)
              .join('\n');
      return {
        contents: [
          {
            uri: uri.toString(),
            text: `# Notes in category "${categoryName}"\n\n${body}`,
            mimeType: 'text/markdown',
          },
        ],
      };
    },
  );
}
