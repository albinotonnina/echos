import { describe, it, expect } from 'vitest';
import { isPrivateIp, validateUrl } from './url-validator.js';
import { createRateLimiter } from './rate-limiter.js';
import { validateContentSize, validateBufferSize, CONTENT_SIZE_DEFAULTS } from './content-size.js';
import { timingSafeStringEqual } from './timing-safe.js';

// ---------------------------------------------------------------------------
// URL Validator — additional coverage for new blocked entries
// ---------------------------------------------------------------------------

describe('isPrivateIp — enhanced checks', () => {
  it('blocks AWS/Azure instance metadata IP', () => {
    expect(isPrivateIp('169.254.169.254')).toBe(true);
  });

  it('blocks Azure platform endpoint IP', () => {
    expect(isPrivateIp('168.63.129.16')).toBe(true);
  });

  it('blocks instance-data hostname', () => {
    expect(isPrivateIp('instance-data')).toBe(true);
  });

  it('blocks CGNAT range (100.64.0.0/10)', () => {
    expect(isPrivateIp('100.64.0.1')).toBe(true);
    expect(isPrivateIp('100.127.255.255')).toBe(true);
  });

  it('does not block unrelated public IPs', () => {
    expect(isPrivateIp('1.1.1.1')).toBe(false);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('100.128.0.1')).toBe(false); // just outside CGNAT
  });
});

describe('validateUrl — cloud metadata rejection', () => {
  it('rejects requests to AWS IMDS URL', () => {
    expect(() => validateUrl('http://169.254.169.254/latest/meta-data/')).toThrow('private/internal');
  });

  it('rejects Azure IMDS URL', () => {
    expect(() => validateUrl('http://168.63.129.16/')).toThrow('private/internal');
  });
});

// ---------------------------------------------------------------------------
// Rate Limiter — max-buckets cap
// ---------------------------------------------------------------------------

describe('createRateLimiter — max-keys eviction', () => {
  it('does not grow beyond maxKeys buckets', () => {
    // 1 token per key, no refill, max 5 buckets
    const limiter = createRateLimiter(1, 0, 5);

    // Oldest bucket: 'user-0' — exhaust it.
    expect(limiter.consume('user-0')).toBe(true);  // uses the only token
    expect(limiter.consume('user-0')).toBe(false); // bucket is now exhausted

    // Fill remaining buckets up to capacity with distinct users.
    for (let i = 1; i < 5; i++) {
      expect(limiter.consume(`user-${i}`)).toBe(true);
    }

    // Adding a 6th key should evict the oldest ('user-0'), keeping size at 5.
    expect(limiter.consume('user-5')).toBe(true);

    // Because 'user-0' was evicted, consuming it again should create
    // a fresh bucket with a new token, returning true instead of false.
    expect(limiter.consume('user-0')).toBe(true);
  });

  it('still rate-limits after eviction', () => {
    const limiter = createRateLimiter(1, 0, 2); // 1 token, no refill, max 2 buckets

    expect(limiter.consume('a')).toBe(true);  // use the only token for 'a'
    expect(limiter.consume('b')).toBe(true);  // use the only token for 'b'

    // Adding 'c' evicts the oldest ('a'). 'c' gets a fresh bucket.
    expect(limiter.consume('c')).toBe(true);

    // 'b' was not evicted — it is now exhausted
    expect(limiter.consume('b')).toBe(false);

    // Since 'a' was evicted earlier, consuming it again should create a fresh bucket.
    expect(limiter.consume('a')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Content Size Validation
// ---------------------------------------------------------------------------

describe('validateContentSize', () => {
  it('accepts content within the default limit', () => {
    const text = 'hello world';
    expect(validateContentSize(text)).toBe(text);
  });

  it('accepts content exactly at the limit', () => {
    const text = 'a'.repeat(CONTENT_SIZE_DEFAULTS.maxChars);
    expect(() => validateContentSize(text)).not.toThrow();
  });

  it('rejects content exceeding the default limit', () => {
    const text = 'a'.repeat(CONTENT_SIZE_DEFAULTS.maxChars + 1);
    expect(() => validateContentSize(text)).toThrow('exceeds maximum allowed size');
  });

  it('respects a custom maxChars limit', () => {
    expect(() => validateContentSize('hello world', { maxChars: 5 })).toThrow('exceeds maximum allowed size');
    expect(validateContentSize('hello', { maxChars: 5 })).toBe('hello');
  });

  it('includes the provided label in the error message', () => {
    expect(() => validateContentSize('hello world', { maxChars: 3, label: 'note title' })).toThrow('note title');
  });
});

describe('validateBufferSize', () => {
  it('accepts a buffer within the default limit', () => {
    const buf = Buffer.from('small');
    expect(validateBufferSize(buf)).toBe(buf);
  });

  it('rejects a buffer exceeding a custom limit', () => {
    const buf = Buffer.alloc(11);
    expect(() => validateBufferSize(buf, { maxBytes: 10, label: 'upload' })).toThrow('upload');
  });
});

// ---------------------------------------------------------------------------
// Timing-safe String Comparison
// ---------------------------------------------------------------------------

describe('timingSafeStringEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeStringEqual('secret-token', 'secret-token')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(timingSafeStringEqual('secret-token', 'wrong-token')).toBe(false);
  });

  it('returns false for empty vs non-empty', () => {
    expect(timingSafeStringEqual('', 'token')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(timingSafeStringEqual('', '')).toBe(true);
  });

  it('is case-sensitive', () => {
    expect(timingSafeStringEqual('Token', 'token')).toBe(false);
  });

  it('handles strings of different lengths without throwing', () => {
    expect(() => timingSafeStringEqual('short', 'a-much-longer-secret-value')).not.toThrow();
    expect(timingSafeStringEqual('short', 'a-much-longer-secret-value')).toBe(false);
  });
});
