import { existsSync, readFileSync } from 'node:fs';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import matter from 'gray-matter';
import type { SqliteStorage } from '../storage/sqlite.js';
import type { MarkdownStorage } from '../storage/markdown.js';

export interface ResourceProviderDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
}

function toStr(v: string | string[]): string {
  return Array.isArray(v) ? v[0] ?? '' : v;
}

export function registerResources(server: McpServer, deps: ResourceProviderDeps): void {
  // notes://{noteId} — browse and read individual notes
  // Note: list is capped at 1000 entries (MCP resource listing has no standard pagination).
  server.registerResource(
    'notes',
    new ResourceTemplate('notes://{noteId}', {
      list: async () => {
        const rows = deps.sqlite.listNotes({ limit: 1000, excludeContent: true });
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
      // Return the raw stored file when it exists — this is the faithful representation
      // including all frontmatter fields (links, gist, status, inputSource, source_url, etc.)
      // serialised safely by gray-matter.
      if (existsSync(row.filePath)) {
        const rawText = readFileSync(row.filePath, 'utf-8');
        return {
          contents: [{ uri: uri.toString(), text: rawText, mimeType: 'text/markdown' }],
        };
      }
      // Fallback: reconstruct from the sqlite row using gray-matter so that all values are
      // correctly escaped and all metadata fields are included.
      const fm: Record<string, unknown> = {
        id: row.id,
        type: row.type,
        title: row.title,
        created: row.created,
        updated: row.updated,
        tags: row.tags.split(',').filter(Boolean),
        links: row.links.split(',').filter(Boolean),
        category: row.category,
      };
      if (row.sourceUrl) fm['source_url'] = row.sourceUrl;
      if (row.author) fm['author'] = row.author;
      if (row.gist) fm['gist'] = row.gist;
      if (row.status) fm['status'] = row.status;
      if (row.inputSource) fm['inputSource'] = row.inputSource;
      const text = matter.stringify(row.content, fm);
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
      const rawTagName = toStr(variables['tagName'] ?? '');
      let tagName: string;
      try {
        tagName = decodeURIComponent(rawTagName);
      } catch {
        return {
          contents: [
            {
              uri: uri.toString(),
              text: `# Invalid tag URI\n\nThe tag name in this resource URI is not valid percent-encoded text: ${rawTagName}`,
              mimeType: 'text/markdown',
            },
          ],
        };
      }
      const rows = deps.sqlite.listNotes({ tags: [tagName], limit: 500, excludeContent: true });
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
      const rawCategoryName = toStr(variables['categoryName'] ?? '');
      let categoryName: string;
      try {
        categoryName = decodeURIComponent(rawCategoryName);
      } catch {
        return {
          contents: [
            {
              uri: uri.toString(),
              text: `# Invalid category URI\n\nThe category name in this resource URI is not valid percent-encoded text: ${rawCategoryName}`,
              mimeType: 'text/markdown',
            },
          ],
        };
      }
      const rows = deps.sqlite.listNotes({ category: categoryName, limit: 500, excludeContent: true });
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
