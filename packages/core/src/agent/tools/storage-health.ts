import { existsSync } from 'node:fs';
import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { SqliteStorage } from '../../storage/sqlite.js';
import type { MarkdownStorage } from '../../storage/markdown.js';
import type { VectorStorage } from '../../storage/vectordb.js';

export interface StorageHealthToolDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
  vectorDb: VectorStorage;
}

const schema = Type.Object({});
type Params = Static<typeof schema>;

export function createStorageHealthTool(deps: StorageHealthToolDeps): AgentTool<typeof schema> {
  return {
    name: 'storage_health',
    label: 'Storage Health',
    description:
      'Reports the health of the storage layer: total notes, orphaned markdown files (on disk but not in SQLite), orphaned SQLite rows (no markdown file on disk), broken vector embeddings (zero-vectors), and missing embeddings (in SQLite but not in LanceDB). Use when the user asks about storage health, data integrity, or orphaned files.',
    parameters: schema,
    execute: async (_toolCallId: string, _params: Params) => {
      const db = deps.sqlite.db;

      // 1. All SQLite notes (id + filePath)
      const sqliteNotes = db
        .prepare('SELECT id, file_path AS filePath FROM notes')
        .all() as { id: string; filePath: string }[];

      const sqliteIds = new Set(sqliteNotes.map((n) => n.id));
      const totalNotes = sqliteNotes.length;

      // 2. All markdown files tracked on disk (via markdown index)
      const mdNotes = deps.markdown.list();
      const mdIds = new Set(mdNotes.map((n) => n.metadata.id));

      // 3. Orphaned MD files: in markdown index but not in SQLite
      const orphanedMdFiles: string[] = [];
      for (const id of mdIds) {
        if (!sqliteIds.has(id)) {
          orphanedMdFiles.push(id);
        }
      }

      // 4. Orphaned SQLite rows: file_path does not exist on disk
      const orphanedSqliteRows: { id: string; filePath: string }[] = [];
      for (const row of sqliteNotes) {
        if (!existsSync(row.filePath)) {
          orphanedSqliteRows.push({ id: row.id, filePath: row.filePath });
        }
      }

      // 5. Vector embedding health
      const embeddingHealth = await deps.vectorDb.getEmbeddingHealth();
      const vectorIds = new Set(embeddingHealth.map((e) => e.id));
      const brokenEmbeddings = embeddingHealth.filter((e) => e.isBroken).map((e) => e.id);

      // 6. Missing embeddings: in SQLite but not in LanceDB
      const missingEmbeddings: string[] = [];
      for (const id of sqliteIds) {
        if (!vectorIds.has(id)) {
          missingEmbeddings.push(id);
        }
      }

      const report = {
        totalNotes,
        orphanedMarkdownFiles: {
          count: orphanedMdFiles.length,
          ids: orphanedMdFiles.slice(0, 20),
        },
        orphanedSqliteRows: {
          count: orphanedSqliteRows.length,
          items: orphanedSqliteRows.slice(0, 20),
        },
        brokenEmbeddings: {
          count: brokenEmbeddings.length,
          ids: brokenEmbeddings.slice(0, 20),
        },
        missingEmbeddings: {
          count: missingEmbeddings.length,
          ids: missingEmbeddings.slice(0, 20),
        },
      };

      const healthy =
        orphanedMdFiles.length === 0 &&
        orphanedSqliteRows.length === 0 &&
        brokenEmbeddings.length === 0 &&
        missingEmbeddings.length === 0;

      const lines: string[] = [
        `## Storage Health Report`,
        ``,
        `**Status**: ${healthy ? '✅ Healthy' : '⚠️ Issues found'}`,
        `**Total notes**: ${totalNotes}`,
        ``,
        `### Orphaned Markdown Files (on disk, not in SQLite): ${report.orphanedMarkdownFiles.count}`,
        report.orphanedMarkdownFiles.count > 0
          ? report.orphanedMarkdownFiles.ids.map((id) => `- \`${id}\``).join('\n') +
            (report.orphanedMarkdownFiles.count > 20
              ? `\n- … and ${report.orphanedMarkdownFiles.count - 20} more`
              : '')
          : '_None_',
        ``,
        `### Orphaned SQLite Rows (SQLite entry, no file on disk): ${report.orphanedSqliteRows.count}`,
        report.orphanedSqliteRows.count > 0
          ? report.orphanedSqliteRows.items
              .map((r) => `- \`${r.id}\` → \`${r.filePath}\``)
              .join('\n') +
            (report.orphanedSqliteRows.count > 20
              ? `\n- … and ${report.orphanedSqliteRows.count - 20} more`
              : '')
          : '_None_',
        ``,
        `### Broken Vector Embeddings (zero-vector): ${report.brokenEmbeddings.count}`,
        report.brokenEmbeddings.count > 0
          ? report.brokenEmbeddings.ids.map((id) => `- \`${id}\``).join('\n') +
            (report.brokenEmbeddings.count > 20
              ? `\n- … and ${report.brokenEmbeddings.count - 20} more`
              : '')
          : '_None_',
        ``,
        `### Missing Embeddings (in SQLite, not in LanceDB): ${report.missingEmbeddings.count}`,
        report.missingEmbeddings.count > 0
          ? report.missingEmbeddings.ids.map((id) => `- \`${id}\``).join('\n') +
            (report.missingEmbeddings.count > 20
              ? `\n- … and ${report.missingEmbeddings.count - 20} more`
              : '')
          : '_None_',
      ];

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: report,
      };
    },
  };
}
