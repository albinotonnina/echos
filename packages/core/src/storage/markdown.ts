import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import matter from 'gray-matter';
import type { Logger } from 'pino';
import type { NoteMetadata, Note, ContentType } from '@echos/shared';

export interface MarkdownStorage {
  save(metadata: NoteMetadata, content: string): string;
  read(filePath: string): Note | undefined;
  readById(id: string): Note | undefined;
  update(filePath: string, metadata: Partial<NoteMetadata>, content?: string): Note;
  remove(filePath: string): void;
  list(type?: ContentType): Note[];
}

function buildFilePath(baseDir: string, meta: NoteMetadata): string {
  const date = meta.created.slice(0, 10);
  const slug = meta.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  const dir = join(baseDir, meta.type, meta.category || 'uncategorized');
  return join(dir, `${date}-${slug}.md`);
}

function metadataToFrontmatter(meta: NoteMetadata): Record<string, unknown> {
  const fm: Record<string, unknown> = {
    id: meta.id,
    type: meta.type,
    title: meta.title,
    created: meta.created,
    updated: meta.updated,
    tags: meta.tags,
    links: meta.links,
    category: meta.category,
  };
  if (meta.sourceUrl) fm['source_url'] = meta.sourceUrl;
  if (meta.author) fm['author'] = meta.author;
  if (meta.gist) fm['gist'] = meta.gist;
  return fm;
}

function frontmatterToMetadata(data: Record<string, unknown>): NoteMetadata {
  const meta: NoteMetadata = {
    id: data['id'] as string,
    type: data['type'] as ContentType,
    title: data['title'] as string,
    created: data['created'] as string,
    updated: data['updated'] as string,
    tags: (data['tags'] as string[]) || [],
    links: (data['links'] as string[]) || [],
    category: (data['category'] as string) || '',
  };
  if (data['source_url']) meta.sourceUrl = data['source_url'] as string;
  if (data['author']) meta.author = data['author'] as string;
  if (data['gist']) meta.gist = data['gist'] as string;
  return meta;
}

export function createMarkdownStorage(baseDir: string, logger: Logger): MarkdownStorage {
  mkdirSync(baseDir, { recursive: true });

  // In-memory index: id -> filePath
  const idIndex = new Map<string, string>();

  // Scan existing files to build index
  function scanDirectory(dir: string): void {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDirectory(fullPath);
      } else if (entry.name.endsWith('.md')) {
        try {
          const raw = readFileSync(fullPath, 'utf-8');
          const { data } = matter(raw);
          if (data['id']) {
            idIndex.set(data['id'] as string, fullPath);
          }
        } catch {
          // Skip malformed files
        }
      }
    }
  }

  scanDirectory(baseDir);
  logger.info({ baseDir, fileCount: idIndex.size }, 'Markdown storage initialized');

  return {
    save(metadata: NoteMetadata, content: string): string {
      const filePath = buildFilePath(baseDir, metadata);
      mkdirSync(dirname(filePath), { recursive: true });

      const fm = metadataToFrontmatter(metadata);
      const fileContent = matter.stringify(content, fm);
      writeFileSync(filePath, fileContent, 'utf-8');

      idIndex.set(metadata.id, filePath);
      logger.debug({ id: metadata.id, filePath }, 'Note saved');
      return filePath;
    },

    read(filePath: string): Note | undefined {
      if (!existsSync(filePath)) return undefined;
      try {
        const raw = readFileSync(filePath, 'utf-8');
        const { data, content } = matter(raw);
        return {
          metadata: frontmatterToMetadata(data),
          content: content.trim(),
          filePath,
        };
      } catch (err) {
        logger.error({ err, filePath }, 'Failed to read note');
        return undefined;
      }
    },

    readById(id: string): Note | undefined {
      const filePath = idIndex.get(id);
      if (!filePath) return undefined;
      return this.read(filePath);
    },

    update(filePath: string, partialMeta: Partial<NoteMetadata>, newContent?: string): Note {
      const existing = this.read(filePath);
      if (!existing) {
        throw new Error(`Note not found: ${filePath}`);
      }

      const metadata: NoteMetadata = {
        ...existing.metadata,
        ...partialMeta,
        updated: new Date().toISOString(),
      };
      const content = newContent ?? existing.content;

      const fm = metadataToFrontmatter(metadata);
      const fileContent = matter.stringify(content, fm);
      writeFileSync(filePath, fileContent, 'utf-8');

      return { metadata, content, filePath };
    },

    remove(filePath: string): void {
      const note = this.read(filePath);
      if (note) {
        idIndex.delete(note.metadata.id);
      }
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        logger.debug({ filePath }, 'Note removed');
      }
    },

    list(type?: ContentType): Note[] {
      const notes: Note[] = [];
      for (const filePath of idIndex.values()) {
        const note = this.read(filePath);
        if (note && (!type || note.metadata.type === type)) {
          notes.push(note);
        }
      }
      return notes.sort(
        (a, b) => new Date(b.metadata.created).getTime() - new Date(a.metadata.created).getTime(),
      );
    },
  };
}
