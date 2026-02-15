import type { Context, NextFunction } from 'grammy';
import { createRateLimiter, type RateLimiter } from '@echos/shared';

export function createRateLimitMiddleware(
  limiter?: RateLimiter,
): (ctx: Context, next: NextFunction) => Promise<void> {
  const rl = limiter ?? createRateLimiter(20, 1);

  return async (ctx: Context, next: NextFunction): Promise<void> => {
    const userId = ctx.from?.id;
    if (!userId) return;

    if (!rl.consume(String(userId))) {
      await ctx.reply('Rate limit exceeded. Please wait a moment.');
      return;
    }

    await next();
  };
}
