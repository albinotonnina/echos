import type { BotError, Context } from 'grammy';
import type { Logger } from 'pino';

export function createErrorHandler(logger: Logger): (err: BotError<Context>) => void {
  return (err: BotError<Context>): void => {
    logger.error({ err: err.error, chatId: err.ctx.chat?.id, userId: err.ctx.from?.id }, 'Bot error');
  };
}
