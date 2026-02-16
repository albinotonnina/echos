import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import DOMPurify from 'isomorphic-dompurify';
import type { Logger } from 'pino';
import { validateUrl, sanitizeHtml } from '@echos/shared';
import type { ProcessedContent } from '@echos/shared';

const MAX_CONTENT_SIZE = 5 * 1024 * 1024; // 5MB
const FETCH_TIMEOUT = 30000; // 30s

export async function processArticle(url: string, logger: Logger): Promise<ProcessedContent> {
  const validatedUrl = validateUrl(url);
  logger.info({ url: validatedUrl }, 'Processing article');

  const response = await fetch(validatedUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    headers: {
      'User-Agent': 'EchOS/1.0 (Knowledge Assistant)',
      Accept: 'text/html',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch article: ${response.status} ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_CONTENT_SIZE) {
    throw new Error('Article content too large');
  }

  const html = await response.text();

  if (html.length > MAX_CONTENT_SIZE) {
    throw new Error('Article content too large');
  }

  // Sanitize HTML before parsing
  const cleanHtml = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    RETURN_DOM: false,
  });

  const dom = new JSDOM(cleanHtml, { url: validatedUrl });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article) {
    throw new Error('Could not extract article content');
  }

  const content = sanitizeHtml(article.content ?? '');
  const title = sanitizeHtml(article.title ?? 'Untitled Article');

  const metadata: ProcessedContent['metadata'] = {
    type: 'article',
    sourceUrl: validatedUrl,
  };
  if (article.byline) metadata.author = sanitizeHtml(article.byline);

  logger.info({ title, contentLength: content.length }, 'Article processed');

  return {
    title,
    content,
    metadata,
    embedText: `${title}\n\n${article.excerpt ?? ''}\n\n${content.slice(0, 2000)}`,
  };
}
