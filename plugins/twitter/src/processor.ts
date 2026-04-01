import type { Logger } from 'pino';
import type { ProcessedContent } from '@echos/shared';

const FETCH_TIMEOUT = 15000; // 15s
const MAX_THREAD_TWEETS = 25;

const TWEET_URL_REGEX =
  /(?:twitter\.com|x\.com|mobile\.twitter\.com|fxtwitter\.com|vxtwitter\.com)\/\w+\/status\/(\d+)/;

/** FxTwitter API response types */
interface FxTweetAuthor {
  name: string;
  screen_name: string;
}

interface FxArticleBlock {
  key: string;
  text: string;
  type: string;
  entityRanges: unknown[];
  inlineStyleRanges: unknown[];
  data: unknown;
}

interface FxEntityRange {
  key: number;
  length: number;
  offset: number;
}

interface FxEntityMapEntry {
  value?: {
    type?: string;
    data?: {
      mediaItems?: Array<{ mediaId?: string }>;
      caption?: string;
    };
  };
}

interface FxVideoVariant {
  content_type?: string;
  bit_rate?: number;
  url?: string;
}

interface FxMediaEntityInfo {
  __typename?: string;
  original_img_url?: string;
  preview_image?: { original_img_url?: string };
  variants?: FxVideoVariant[];
}

interface FxMediaEntity {
  media_id?: string;
  media_info?: FxMediaEntityInfo;
}

interface FxArticle {
  title: string;
  preview_text: string;
  content: {
    blocks: FxArticleBlock[];
    entityMap: Record<string, FxEntityMapEntry>;
  };
  cover_media?: unknown;
  created_at: string;
  id: string;
  media_entities?: FxMediaEntity[];
  modified_at: string;
}

interface FxMediaItem {
  url: string;
  thumbnail_url?: string;
  type: 'photo' | 'video' | 'gif';
  width?: number;
  height?: number;
}

interface FxTweetMedia {
  all?: FxMediaItem[];
  videos?: FxMediaItem[];
}

interface FxTweet {
  text: string;
  author: FxTweetAuthor;
  created_at: string;
  created_timestamp: number;
  likes: number;
  retweets: number;
  replies: number;
  views?: number;
  media?: FxTweetMedia;
  quote?: FxTweet;
  replying_to?: string;
  replying_to_status?: string;
  id: string;
  article?: FxArticle;
}

interface FxTwitterResponse {
  code: number;
  message: string;
  tweet?: FxTweet;
}

/**
 * Extract a tweet ID from various Twitter/X URL formats.
 * Returns null if the URL doesn't match any known pattern.
 */
export function extractTweetId(url: string): string | null {
  const match = url.match(TWEET_URL_REGEX);
  return match?.[1] ?? null;
}

/** Fetch a single tweet from FxTwitter API. */
async function fetchTweet(tweetId: string, logger: Logger): Promise<FxTweet> {
  const apiUrl = `https://api.fxtwitter.com/status/${tweetId}`;

  const response = await fetch(apiUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    headers: {
      'User-Agent': 'EchOS/1.0 (Knowledge Assistant)',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`FxTwitter API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as FxTwitterResponse;

  if (data.code !== 200 || !data.tweet) {
    throw new Error(`Tweet not found: ${data.message}`);
  }

  logger.debug({ tweetId, author: data.tweet.author.screen_name }, 'Fetched tweet');
  return data.tweet;
}

/**
 * Walk up the reply chain to find thread tweets by the same author.
 * Returns tweets in chronological order (oldest first).
 */
async function unrollThread(tweet: FxTweet, logger: Logger): Promise<FxTweet[]> {
  const tweets: FxTweet[] = [tweet];
  let current = tweet;
  let depth = 0;

  // Walk upward through replying_to_status
  while (current.replying_to_status && depth < MAX_THREAD_TWEETS - 1) {
    try {
      const parent = await fetchTweet(current.replying_to_status, logger);

      // Only include if same author (thread continuation)
      if (parent.author.screen_name !== tweet.author.screen_name) {
        break;
      }

      tweets.unshift(parent);
      current = parent;
      depth++;
    } catch (error) {
      logger.debug({ error, depth }, 'Thread walk-up stopped');
      break;
    }
  }

  return tweets;
}

/** Format a date from a Unix timestamp. */
function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Format engagement stats. */
function formatEngagement(tweet: FxTweet): string {
  const parts: string[] = [];
  if (tweet.likes > 0) parts.push(`${tweet.likes.toLocaleString()} likes`);
  if (tweet.retweets > 0) parts.push(`${tweet.retweets.toLocaleString()} retweets`);
  if (tweet.replies > 0) parts.push(`${tweet.replies.toLocaleString()} replies`);
  if (tweet.views && tweet.views > 0) parts.push(`${tweet.views.toLocaleString()} views`);
  return parts.join(' · ');
}

/** Format media references as markdown. */
function formatMedia(tweet: FxTweet): string {
  if (!tweet.media?.all) return '';

  const lines: string[] = [];
  for (const item of tweet.media.all) {
    if (item.type === 'photo') {
      lines.push(`![image](${item.url})`);
    } else if (item.type === 'video' || item.type === 'gif') {
      lines.push(`[Video](${item.url})`);
    }
  }
  return lines.join('\n');
}

/** Collect all media from a list of tweets. */
function collectMedia(tweets: FxTweet[]): string {
  const mediaLines: string[] = [];
  for (const tweet of tweets) {
    const media = formatMedia(tweet);
    if (media) mediaLines.push(media);
  }
  return mediaLines.join('\n');
}

/** Format a quoted tweet section. */
function formatQuoteTweet(quote: FxTweet): string {
  const date = formatDate(quote.created_timestamp);
  const quotedLines = quote.text.split('\n').map((line) => `> ${line}`).join('\n');
  let section = `### Quoted Tweet\n\n`;
  section += `${quotedLines}\n\n`;
  section += `— @${quote.author.screen_name} (${quote.author.name}), ${date}`;
  return section;
}

/** Render an atomic block as inline markdown via entityMap → media_entities chain. */
function renderAtomicBlock(
  block: FxArticleBlock,
  entityMap: Record<string, FxEntityMapEntry>,
  mediaById: Map<string, FxMediaEntity>,
): string {
  const ranges = block.entityRanges as FxEntityRange[];
  if (!ranges?.[0]) return '';

  const entityKey = String(ranges[0].key);
  const entity = entityMap[entityKey];

  if (entity?.value?.type === 'DIVIDER') {
    return '---';
  }

  const mediaId = entity?.value?.data?.mediaItems?.[0]?.mediaId;
  if (!mediaId) return '';

  const mediaEntity = mediaById.get(mediaId);
  if (!mediaEntity?.media_info) return '';

  const info = mediaEntity.media_info;
  const caption = entity.value?.data?.caption ? `\n*${entity.value.data.caption}*` : '';

  if (info.__typename === 'ApiImage') {
    const url = info.original_img_url;
    return url ? `![image](${url})${caption}` : '';
  }

  if (info.__typename === 'ApiVideo') {
    const variants = info.variants ?? [];
    let bestMp4: FxVideoVariant | undefined;
    for (const v of variants) {
      if (v.content_type === 'video/mp4') {
        if (!bestMp4 || (v.bit_rate ?? 0) > (bestMp4.bit_rate ?? 0)) {
          bestMp4 = v;
        }
      }
    }
    const url = bestMp4?.url ?? info.preview_image?.original_img_url;
    return url ? `[Video](${url})${caption}` : '';
  }

  return '';
}

/** Format draft.js blocks into markdown. */
function formatArticleBlocks(
  blocks: FxArticleBlock[],
  entityMap?: Record<string, FxEntityMapEntry>,
  mediaEntities?: FxMediaEntity[],
): string {
  const resolvedEntityMap = entityMap ?? {};
  const mediaById = new Map<string, FxMediaEntity>();
  for (const me of mediaEntities ?? []) {
    if (me.media_id) mediaById.set(me.media_id, me);
  }
  const markdownBlocks: string[] = [];

  for (const block of blocks) {
    if (block.type === 'atomic') {
      const media = renderAtomicBlock(block, resolvedEntityMap, mediaById);
      if (media) markdownBlocks.push(media);
      continue;
    }

    if (!block.text && block.type === 'unstyled') {
      markdownBlocks.push('');
      continue;
    }

    const text = block.text;

    switch (block.type) {
      case 'header-one':
        markdownBlocks.push(`# ${text}`);
        break;
      case 'header-two':
        markdownBlocks.push(`## ${text}`);
        break;
      case 'header-three':
        markdownBlocks.push(`### ${text}`);
        break;
      case 'header-four':
        markdownBlocks.push(`#### ${text}`);
        break;
      case 'header-five':
        markdownBlocks.push(`##### ${text}`);
        break;
      case 'header-six':
        markdownBlocks.push(`###### ${text}`);
        break;
      case 'blockquote':
        markdownBlocks.push(`> ${text}`);
        break;
      case 'code-block':
        markdownBlocks.push(`\`\`\`\n${text}\n\`\`\``);
        break;
      case 'unordered-list-item':
        markdownBlocks.push(`* ${text}`);
        break;
      case 'ordered-list-item':
        markdownBlocks.push(`1. ${text}`);
        break;
      case 'unstyled':
      default:
        markdownBlocks.push(text);
        break;
    }
  }

  return markdownBlocks.join('\n\n');
}

/** Format a single tweet as markdown. */
function formatSingleTweet(tweet: FxTweet, sourceUrl: string): string {
  const date = formatDate(tweet.created_timestamp);
  const engagement = formatEngagement(tweet);

  let markdown = '';

  if (tweet.article) {
    if (tweet.article.title) {
      markdown += `# ${tweet.article.title}\n\n`;
    }
    markdown += `${formatArticleBlocks(tweet.article.content.blocks, tweet.article.content.entityMap, tweet.article.media_entities ?? [])}\n\n`;
  } else if (tweet.text) {
    const tweetLines = tweet.text.split('\n').map((line) => `> ${line}`).join('\n');
    markdown += `${tweetLines}\n\n`;
  }

  markdown += `— @${tweet.author.screen_name} (${tweet.author.name}), ${date}\n\n`;
  if (engagement) markdown += `${engagement}\n\n`;

  if (tweet.quote) {
    markdown += `${formatQuoteTweet(tweet.quote)}\n\n`;
  }

  const media = formatMedia(tweet);
  if (media) {
    markdown += `### Media\n\n${media}\n\n`;
  }

  markdown += `Source: ${sourceUrl}`;
  return markdown;
}

/** Format a thread as a clean article. */
function formatThread(tweets: FxTweet[], sourceUrl: string): string {
  const firstTweet = tweets[0]!;
  const date = formatDate(firstTweet.created_timestamp);

  // Join tweet texts into paragraphs, stripping self-reply @mentions
  const selfMentionPrefix = `@${firstTweet.author.screen_name} `;
  const paragraphs = tweets.map((t) => {
    let text = t.text;
    // Strip leading self-reply @mention
    if (text.startsWith(selfMentionPrefix)) {
      text = text.slice(selfMentionPrefix.length);
    }

    if (!text && t.article) {
      if (t.article.title) text += `# ${t.article.title}\n\n`;
      text += formatArticleBlocks(t.article.content.blocks, t.article.content.entityMap, t.article.media_entities ?? []);
    }

    return text;
  });

  let markdown = paragraphs.join('\n\n');

  markdown += `\n\n---\n\n`;
  markdown += `*Thread by @${firstTweet.author.screen_name} (${firstTweet.author.name}), ${date} — ${tweets.length} tweets*\n`;

  const engagement = formatEngagement(tweets[0]!);
  if (engagement) markdown += `${engagement}\n`;

  // Collect all quoted tweets
  const quotes = tweets.filter((t) => t.quote).map((t) => t.quote!);
  if (quotes.length > 0) {
    markdown += `\n`;
    for (const quote of quotes) {
      markdown += `${formatQuoteTweet(quote)}\n\n`;
    }
  }

  const media = collectMedia(tweets);
  if (media) {
    markdown += `\n### Media\n\n${media}\n`;
  }

  markdown += `\nSource: ${sourceUrl}`;
  return markdown;
}

/**
 * Process a tweet URL: fetch the tweet, detect threads, and format as markdown.
 */
export async function processTweet(url: string, logger: Logger): Promise<ProcessedContent> {
  const tweetId = extractTweetId(url);
  if (!tweetId) {
    throw new Error(`Invalid Twitter/X URL: ${url}`);
  }

  logger.info({ url, tweetId }, 'Processing tweet');

  const tweet = await fetchTweet(tweetId, logger);

  // Try to unroll thread if this tweet is a reply to the same author
  const isPartOfThread = tweet.replying_to_status != null;
  let tweets: FxTweet[];
  let isThread: boolean;

  if (isPartOfThread) {
    tweets = await unrollThread(tweet, logger);
    isThread = tweets.length > 1;
  } else {
    tweets = [tweet];
    isThread = false;
  }

  const content = isThread
    ? formatThread(tweets, url)
    : formatSingleTweet(tweet, url);

  const author = tweet.author;

  function getPreviewText(t: FxTweet): string {
    return t.text || t.article?.title || t.article?.preview_text || 'X Article';
  }
  function getPlaintextContent(t: FxTweet): string {
    return t.text || (t.article ? t.article.content.blocks.map((b) => b.text).join('\n') : '');
  }

  const firstText = getPreviewText(tweets[0]!);
  const singleText = getPreviewText(tweet);

  const title = isThread
    ? `Thread by @${author.screen_name}: ${firstText.slice(0, 80)}${firstText.length > 80 ? '...' : ''}`
    : `@${author.screen_name}: ${singleText.slice(0, 100)}${singleText.length > 100 ? '...' : ''}`;

  const metadata: ProcessedContent['metadata'] = {
    type: 'tweet',
    sourceUrl: url,
    author: `@${author.screen_name}`,
  };

  const embedText = isThread
    ? `Thread by @${author.screen_name}\n\n${tweets.map(getPlaintextContent).join('\n\n')}`
    : `Tweet by @${author.screen_name}\n\n${getPlaintextContent(tweet)}`;

  logger.info(
    { title, isThread, tweetCount: tweets.length, contentLength: content.length },
    'Tweet processed',
  );

  return {
    title,
    content,
    metadata,
    embedText: embedText.slice(0, 3000),
  };
}
