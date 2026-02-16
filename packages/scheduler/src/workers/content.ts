import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import type { JobData } from '../queue.js';
import { processArticle, processYoutube } from '@echos/core';
import type { SqliteStorage, MarkdownStorage, VectorStorage } from '@echos/core';
import type { NoteMetadata } from '@echos/shared';
import { v4 as uuidv4 } from 'uuid';

export interface ContentWorkerDeps {
  sqlite: SqliteStorage;
  markdown: MarkdownStorage;
  vectorDb: VectorStorage;
  generateEmbedding: (text: string) => Promise<number[]>;
  logger: Logger;
  openaiApiKey?: string;
  notifyUser?: (chatId: number, message: string) => Promise<void>;
}

export function createContentProcessor(deps: ContentWorkerDeps) {
  return async (job: Job<JobData>): Promise<void> => {
    const { type, url, chatId, tags, category } = job.data;

    if (type !== 'process_article' && type !== 'process_youtube') return;
    if (!url) throw new Error('Missing URL');

    const processed =
      type === 'process_article'
        ? await processArticle(url, deps.logger)
        : await processYoutube(url, deps.logger, deps.openaiApiKey);

    const now = new Date().toISOString();
    const id = uuidv4();

    const metadata: NoteMetadata = {
      id,
      type: type === 'process_article' ? 'article' : 'youtube',
      title: processed.title,
      created: now,
      updated: now,
      tags: tags ?? [],
      links: [],
      category: category ?? (type === 'process_article' ? 'articles' : 'videos'),
      sourceUrl: url,
    };
    if (processed.metadata.author) metadata.author = processed.metadata.author;

    const filePath = deps.markdown.save(metadata, processed.content);
    deps.sqlite.upsertNote(metadata, processed.content, filePath);

    if (processed.embedText) {
      try {
        const vector = await deps.generateEmbedding(processed.embedText);
        await deps.vectorDb.upsert({
          id,
          text: processed.embedText,
          vector,
          type: metadata.type,
          title: processed.title,
        });
      } catch {
        // Non-fatal
      }
    }

    deps.logger.info({ id, title: processed.title, type }, 'Content processed');

    if (chatId && deps.notifyUser) {
      await deps.notifyUser(chatId, `Saved "${processed.title}"`);
    }
  };
}
