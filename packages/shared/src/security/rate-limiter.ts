export interface RateLimiter {
  consume(key: string): boolean;
  reset(key: string): void;
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

export function createRateLimiter(
  maxTokens: number = 20,
  refillRatePerSecond: number = 1,
): RateLimiter {
  const buckets = new Map<string, TokenBucket>();

  function refill(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsed * refillRatePerSecond);
    bucket.lastRefill = now;
  }

  return {
    consume(key: string): boolean {
      let bucket = buckets.get(key);
      if (!bucket) {
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
