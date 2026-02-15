import { createHmac } from 'node:crypto';
import type { Logger } from 'pino';

export interface TelegramLoginData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export function verifyTelegramLogin(
  data: TelegramLoginData,
  botToken: string,
  logger: Logger,
): boolean {
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();

  // Build check string (all fields except hash, sorted alphabetically)
  const checkFields: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (key !== 'hash' && value !== undefined) {
      checkFields.push(`${key}=${value}`);
    }
  }
  checkFields.sort();
  const checkString = checkFields.join('\n');

  const hash = createHmac('sha256', secret).update(checkString).digest('hex');

  if (hash !== data.hash) {
    logger.warn({ userId: data.id }, 'Invalid Telegram login hash');
    return false;
  }

  // Check auth_date is not too old (24 hours)
  const maxAge = 86400;
  const now = Math.floor(Date.now() / 1000);
  if (now - data.auth_date > maxAge) {
    logger.warn({ userId: data.id, authDate: data.auth_date }, 'Expired Telegram login');
    return false;
  }

  return true;
}
