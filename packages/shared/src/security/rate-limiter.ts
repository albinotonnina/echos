export interface RateLimiter {
  consume(key: string): boolean;
  reset(key: string): void;
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

/**
 * Maximum number of distinct keys that can be tracked simultaneously.
 * When this limit is reached the oldest bucket is evicted before a new one is
 * created, preventing unbounded memory growth from many unique callers.
 */
const DEFAULT_MAX_KEYS = 10_000;

export function createRateLimiter(
  maxTokens: number = 20,
  refillRatePerSecond: number = 1,
  maxKeys: number = DEFAULT_MAX_KEYS,
): RateLimiter {
  const buckets = new Map<string, TokenBucket>();

  function refill(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsed * refillRatePerSecond);
    bucket.lastRefill = now;
  }

  /**
   * Evict the bucket that was inserted earliest. JavaScript `Map` iterates in
   * insertion order, so the first key is always the oldest — O(1) deletion.
   */
  function evictOldest(): void {
    const firstKey = buckets.keys().next().value;
    if (firstKey !== undefined) {
      buckets.delete(firstKey);
    }
  }

  return {
    consume(key: string): boolean {
      let bucket = buckets.get(key);
      if (!bucket) {
        if (buckets.size >= maxKeys) {
          evictOldest();
        }
        bucket = { tokens: maxTokens, lastRefill: Date.now() };
        buckets.set(key, bucket);
      }

      refill(bucket);

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return true;
      }

      return false;
    },

    reset(key: string): void {
      buckets.delete(key);
    },
  };
}
