import type { Context, NextFunction } from 'grammy';
import type { Logger } from 'pino';

export function createAuthMiddleware(
  allowedUserIds: number[],
  logger: Logger,
): (ctx: Context, next: NextFunction) => Promise<void> {
  const allowedSet = new Set(allowedUserIds);

  return async (ctx: Context, next: NextFunction): Promise<void> => {
    const userId = ctx.from?.id;

    if (!userId || !allowedSet.has(userId)) {
      logger.warn({ userId, chatId: ctx.chat?.id }, 'Unauthorized access attempt');
      await ctx.reply('Unauthorized.');
      return;
    }

    await next();
  };
}
