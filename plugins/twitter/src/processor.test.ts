import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractTweetId, processTweet } from './processor.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock @echos/shared (processTweet only imports types, no runtime deps to mock)

const mockLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
} as unknown as import('pino').Logger;

function makeFxTweetResponse(tweet: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({ code: 200, message: 'OK', tweet }),
  };
}

const baseTweet = {
  id: '123456789',
  text: 'This is a test tweet about TypeScript',
  author: { name: 'Test User', screen_name: 'testuser' },
  created_at: 'Mon Jan 01 12:00:00 +0000 2024',
  created_timestamp: 1704110400,
  likes: 42,
  retweets: 10,
  replies: 5,
  views: 1000,
};

describe('extractTweetId', () => {
  it('extracts ID from twitter.com URL', () => {
    expect(extractTweetId('https://twitter.com/user/status/123456789')).toBe('123456789');
  });

  it('extracts ID from x.com URL', () => {
    expect(extractTweetId('https://x.com/user/status/987654321')).toBe('987654321');
  });

  it('extracts ID from mobile.twitter.com URL', () => {
    expect(extractTweetId('https://mobile.twitter.com/user/status/111222333')).toBe('111222333');
  });

  it('extracts ID from fxtwitter.com URL', () => {
    expect(extractTweetId('https://fxtwitter.com/user/status/444555666')).toBe('444555666');
  });

  it('extracts ID from vxtwitter.com URL', () => {
    expect(extractTweetId('https://vxtwitter.com/user/status/777888999')).toBe('777888999');
  });

  it('handles URLs with query parameters', () => {
    expect(extractTweetId('https://x.com/user/status/123456789?s=20')).toBe('123456789');
    expect(extractTweetId('https://twitter.com/user/status/123456789?t=abc&s=20')).toBe(
      '123456789',
    );
  });

  it('returns null for non-Twitter URLs', () => {
    expect(extractTweetId('https://example.com/status/123')).toBeNull();
  });

  it('returns null for invalid URLs', () => {
    expect(extractTweetId('not a url')).toBeNull();
  });

  it('returns null for Twitter URLs without status ID', () => {
    expect(extractTweetId('https://twitter.com/user')).toBeNull();
  });
});

describe('processTweet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws for invalid Twitter URL', async () => {
    await expect(processTweet('https://example.com/not-a-tweet', mockLogger)).rejects.toThrow(
      'Invalid Twitter/X URL',
    );
  });

  it('processes a single tweet', async () => {
    mockFetch.mockResolvedValueOnce(makeFxTweetResponse(baseTweet));

    const result = await processTweet('https://x.com/testuser/status/123456789', mockLogger);

    expect(result.title).toContain('@testuser');
    expect(result.title).toContain('This is a test tweet');
    expect(result.content).toContain('This is a test tweet about TypeScript');
    expect(result.content).toContain('@testuser');
    expect(result.content).toContain('42 likes');
    expect(result.metadata.type).toBe('tweet');
    expect(result.metadata.sourceUrl).toBe('https://x.com/testuser/status/123456789');
    expect(result.metadata.author).toBe('@testuser');
    expect(result.embedText).toContain('Tweet by @testuser');
  });

  it('processes a tweet with media', async () => {
    const tweetWithMedia = {
      ...baseTweet,
      media: {
        all: [
          { url: 'https://pbs.twimg.com/photo1.jpg', type: 'photo', width: 1200, height: 800 },
          { url: 'https://video.twimg.com/video1.mp4', type: 'video', thumbnail_url: 'https://thumb.jpg' },
        ],
        videos: [{ url: 'https://video.twimg.com/video1.mp4', type: 'video', thumbnail_url: 'https://thumb.jpg' }],
      },
    };

    mockFetch.mockResolvedValueOnce(makeFxTweetResponse(tweetWithMedia));

    const result = await processTweet('https://x.com/testuser/status/123456789', mockLogger);

    expect(result.content).toContain('![image](https://pbs.twimg.com/photo1.jpg)');
    expect(result.content).toContain('[Video](https://video.twimg.com/video1.mp4)');
  });

  it('processes a tweet with a quote tweet', async () => {
    const tweetWithQuote = {
      ...baseTweet,
      quote: {
        id: '999',
        text: 'Original quoted content',
        author: { name: 'Quoted User', screen_name: 'quoteduser' },
        created_at: 'Sun Dec 31 12:00:00 +0000 2023',
        created_timestamp: 1704024000,
        likes: 100,
        retweets: 20,
        replies: 3,
      },
    };

    mockFetch.mockResolvedValueOnce(makeFxTweetResponse(tweetWithQuote));

    const result = await processTweet('https://x.com/testuser/status/123456789', mockLogger);

    expect(result.content).toContain('### Quoted Tweet');
    expect(result.content).toContain('Original quoted content');
    expect(result.content).toContain('@quoteduser');
  });

  it('processes an X Article with empty text and draft.js blocks', async () => {
    const articleTweet = {
      ...baseTweet,
      text: '', // Empty text field
      article: {
        title: 'My Awesome Guide',
        preview_text: 'Preview of my awesome guide',
        created_at: '2024-05-15T00:00:00Z',
        modified_at: '2024-05-15T00:00:00Z',
        id: '999',
        content: {
          blocks: [
            {
              key: '1',
              text: 'Introduction',
              type: 'header-one',
              entityRanges: [],
              inlineStyleRanges: [],
              data: {}
            },
            {
              key: '2',
              text: 'This is the first paragraph of the long article.',
              type: 'unstyled',
              entityRanges: [],
              inlineStyleRanges: [],
              data: {}
            },
            {
              key: '3',
              text: 'Steps to follow',
              type: 'header-two',
              entityRanges: [],
              inlineStyleRanges: [],
              data: {}
            },
            {
              key: '4',
              text: 'Step 1',
              type: 'ordered-list-item',
              entityRanges: [],
              inlineStyleRanges: [],
              data: {}
            }
          ],
          entityMap: {}
        }
      }
    };

    mockFetch.mockResolvedValueOnce(makeFxTweetResponse(articleTweet));

    const result = await processTweet('https://x.com/testuser/status/123456789', mockLogger);

    expect(result.title).toContain('My Awesome Guide');
    expect(result.content).toContain('# My Awesome Guide');
    expect(result.content).toContain('# Introduction');
    expect(result.content).toContain('This is the first paragraph of the long article.');
    expect(result.content).toContain('## Steps to follow');
    expect(result.content).toContain('1. Step 1');
    expect(result.embedText).toContain('This is the first paragraph of the long article.');
  });

  it('renders article atomic blocks with inline images', async () => {
    const articleTweet = {
      ...baseTweet,
      text: '',
      article: {
        title: 'Article With Media',
        preview_text: 'Preview',
        created_at: '2024-05-15T00:00:00Z',
        modified_at: '2024-05-15T00:00:00Z',
        id: 'art1',
        content: {
          blocks: [
            { key: '1', text: 'Intro paragraph', type: 'unstyled', entityRanges: [], inlineStyleRanges: [], data: {} },
            { key: '2', text: ' ', type: 'atomic', entityRanges: [{ key: 0, length: 1, offset: 0 }], inlineStyleRanges: [], data: {} },
            { key: '3', text: 'After the image', type: 'unstyled', entityRanges: [], inlineStyleRanges: [], data: {} },
          ],
          entityMap: {
            '0': { value: { type: 'IMAGE', data: { mediaItems: [{ mediaId: 'media_123' }], caption: 'A cool photo' } } },
          },
        },
        media_entities: [
          { media_id: 'media_123', media_info: { __typename: 'ApiImage', original_img_url: 'https://pbs.twimg.com/article/photo1.jpg' } },
        ],
      },
    };

    mockFetch.mockResolvedValueOnce(makeFxTweetResponse(articleTweet));
    const result = await processTweet('https://x.com/testuser/status/123456789', mockLogger);

    expect(result.content).toContain('![image](https://pbs.twimg.com/article/photo1.jpg)');
    expect(result.content).toContain('*A cool photo*');
    expect(result.content).toContain('Intro paragraph');
    expect(result.content).toContain('After the image');
  });

  it('renders article atomic blocks with inline videos', async () => {
    const articleTweet = {
      ...baseTweet,
      text: '',
      article: {
        title: 'Video Article',
        preview_text: 'Preview',
        created_at: '2024-05-15T00:00:00Z',
        modified_at: '2024-05-15T00:00:00Z',
        id: 'art2',
        content: {
          blocks: [
            { key: '1', text: ' ', type: 'atomic', entityRanges: [{ key: 0, length: 1, offset: 0 }], inlineStyleRanges: [], data: {} },
          ],
          entityMap: {
            '0': { value: { type: 'VIDEO', data: { mediaItems: [{ mediaId: 'vid_456' }], caption: '' } } },
          },
        },
        media_entities: [
          {
            media_id: 'vid_456',
            media_info: {
              __typename: 'ApiVideo',
              preview_image: { original_img_url: 'https://pbs.twimg.com/thumb.jpg' },
              variants: [
                { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/playlist.m3u8' },
                { content_type: 'video/mp4', bit_rate: 832000, url: 'https://video.twimg.com/low.mp4' },
                { content_type: 'video/mp4', bit_rate: 2176000, url: 'https://video.twimg.com/high.mp4' },
              ],
            },
          },
        ],
      },
    };

    mockFetch.mockResolvedValueOnce(makeFxTweetResponse(articleTweet));
    const result = await processTweet('https://x.com/testuser/status/123456789', mockLogger);

    expect(result.content).toContain('[Video](https://video.twimg.com/high.mp4)');
    expect(result.content).not.toContain('low.mp4');
  });

  it('renders DIVIDER atomic blocks as horizontal rules', async () => {
    const articleTweet = {
      ...baseTweet,
      text: '',
      article: {
        title: 'Divider Article',
        preview_text: 'Preview',
        created_at: '2024-05-15T00:00:00Z',
        modified_at: '2024-05-15T00:00:00Z',
        id: 'art3',
        content: {
          blocks: [
            { key: '1', text: 'Before divider', type: 'unstyled', entityRanges: [], inlineStyleRanges: [], data: {} },
            { key: '2', text: ' ', type: 'atomic', entityRanges: [{ key: 0, length: 1, offset: 0 }], inlineStyleRanges: [], data: {} },
            { key: '3', text: 'After divider', type: 'unstyled', entityRanges: [], inlineStyleRanges: [], data: {} },
          ],
          entityMap: {
            '0': { value: { type: 'DIVIDER' } },
          },
        },
        media_entities: [],
      },
    };

    mockFetch.mockResolvedValueOnce(makeFxTweetResponse(articleTweet));
    const result = await processTweet('https://x.com/testuser/status/123456789', mockLogger);

    expect(result.content).toContain('Before divider');
    expect(result.content).toContain('---');
    expect(result.content).toContain('After divider');
  });

  it('handles articles with no media entities gracefully', async () => {
    const articleTweet = {
      ...baseTweet,
      text: '',
      article: {
        title: 'No Media Article',
        preview_text: 'Preview',
        created_at: '2024-05-15T00:00:00Z',
        modified_at: '2024-05-15T00:00:00Z',
        id: 'art4',
        content: {
          blocks: [
            { key: '1', text: 'Just text', type: 'unstyled', entityRanges: [], inlineStyleRanges: [], data: {} },
          ],
          entityMap: {},
        },
      },
    };

    mockFetch.mockResolvedValueOnce(makeFxTweetResponse(articleTweet));
    const result = await processTweet('https://x.com/testuser/status/123456789', mockLogger);

    expect(result.content).toContain('Just text');
    expect(result.content).not.toContain('![image]');
    expect(result.content).not.toContain('[Video]');
  });

  it('unrolls a thread (same author reply chain)', async () => {
    const threadTweet2 = {
      ...baseTweet,
      id: '123456790',
      text: '@testuser Second tweet in thread',
      replying_to: 'testuser',
      replying_to_status: '123456789',
    };

    const threadTweet1 = {
      ...baseTweet,
      id: '123456789',
      text: 'First tweet in thread',
    };

    // First call: fetch the shared tweet (tweet 2)
    mockFetch.mockResolvedValueOnce(makeFxTweetResponse(threadTweet2));
    // Second call: walk up to tweet 1
    mockFetch.mockResolvedValueOnce(makeFxTweetResponse(threadTweet1));

    const result = await processTweet('https://x.com/testuser/status/123456790', mockLogger);

    expect(result.title).toContain('Thread by @testuser');
    expect(result.content).toContain('First tweet in thread');
    expect(result.content).toContain('Second tweet in thread');
    expect(result.content).toContain('2 tweets');
    expect(result.embedText).toContain('Thread by @testuser');
  });

  it('stops thread unrolling when a different author is reached', async () => {
    const reply = {
      ...baseTweet,
      id: '123456790',
      text: '@testuser My reply',
      replying_to: 'testuser',
      replying_to_status: '123456789',
    };

    const originalByDifferentAuthor = {
      ...baseTweet,
      id: '123456789',
      text: 'Original by someone else',
      author: { name: 'Other User', screen_name: 'otheruser' },
    };

    mockFetch.mockResolvedValueOnce(makeFxTweetResponse(reply));
    mockFetch.mockResolvedValueOnce(makeFxTweetResponse(originalByDifferentAuthor));

    const result = await processTweet('https://x.com/testuser/status/123456790', mockLogger);

    // Should not be treated as a thread since parent is by different author
    expect(result.title).not.toContain('Thread');
    expect(result.content).not.toContain('Original by someone else');
  });

  it('handles FxTwitter API errors', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });

    await expect(
      processTweet('https://x.com/testuser/status/123456789', mockLogger),
    ).rejects.toThrow('FxTwitter API error: 404 Not Found');
  });

  it('handles tweet not found response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: 404, message: 'Tweet not found' }),
    });

    await expect(
      processTweet('https://x.com/testuser/status/123456789', mockLogger),
    ).rejects.toThrow('Tweet not found');
  });

  it('handles zero engagement stats gracefully', async () => {
    const tweetNoEngagement = {
      ...baseTweet,
      likes: 0,
      retweets: 0,
      replies: 0,
      views: 0,
    };

    mockFetch.mockResolvedValueOnce(makeFxTweetResponse(tweetNoEngagement));

    const result = await processTweet('https://x.com/testuser/status/123456789', mockLogger);

    expect(result.content).not.toContain('likes');
    expect(result.content).not.toContain('retweets');
  });
});
