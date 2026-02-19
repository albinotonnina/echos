import { z } from 'zod';

const commaSeparatedNumbers = z
  .string()
  .transform((s) => s.split(',').map((id) => parseInt(id.trim(), 10)))
  .pipe(z.array(z.number().int().positive()));

const optionalCron = z.string().optional().default('');

export const configSchema = z.object({
  // Required
  telegramBotToken: z.string().optional(), // Required only when enableTelegram=true (checked at runtime)
  allowedUserIds: commaSeparatedNumbers,
  anthropicApiKey: z.string().min(1),

  // Optional
  openaiApiKey: z.string().optional(),

  // Redis
  redisUrl: z.string().url().default('redis://localhost:6379'),

  // Storage paths
  knowledgeDir: z.string().default('./data/knowledge'),
  dbPath: z.string().default('./data/db'),
  sessionDir: z.string().default('./data/sessions'),

  // LLM
  defaultModel: z.string().default('claude-3-5-haiku-20241022'),
  embeddingModel: z.string().default('text-embedding-3-small'),

  // Interfaces
  enableTelegram: z
    .string()
    .default('true')
    .transform((s) => s === 'true'),
  enableWeb: z
    .string()
    .default('false')
    .transform((s) => s === 'true'),
  enableTui: z
    .string()
    .default('false')
    .transform((s) => s === 'true'),

  // Web
  webPort: z.coerce.number().int().positive().default(3000),
  webApiKey: z.string().optional(),

  // Scheduler
  enableScheduler: z
    .string()
    .default('false')
    .transform((s) => s === 'true'),

  // Webshare Proxy (optional)
  webshareProxyUsername: z.string().optional(),
  webshareProxyPassword: z.string().optional(),

  // LLM model presets (for /model switching)
  modelBalanced: z.string().optional(),
  modelDeep: z.string().optional(),

  // LLM reasoning
  thinkingLevel: z
    .enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])
    .default('off'),

  // Debug
  logLlmPayloads: z
    .string()
    .default('false')
    .transform((s) => s === 'true'),

  // Schedules
  digestSchedule: optionalCron,
  newsletterSchedule: optionalCron,
  trendingSchedule: optionalCron,
  reminderCheckSchedule: optionalCron,
});

export type Config = z.infer<typeof configSchema>;

let cachedConfig: Config | null = null;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  if (cachedConfig) return cachedConfig;

  const result = configSchema.safeParse({
    telegramBotToken: env['TELEGRAM_BOT_TOKEN'],
    allowedUserIds: env['ALLOWED_USER_IDS'],
    anthropicApiKey: env['ANTHROPIC_API_KEY'],
    openaiApiKey: env['OPENAI_API_KEY'],
    redisUrl: env['REDIS_URL'],
    knowledgeDir: env['KNOWLEDGE_DIR'],
    dbPath: env['DB_PATH'],
    sessionDir: env['SESSION_DIR'],
    defaultModel: env['DEFAULT_MODEL'],
    embeddingModel: env['EMBEDDING_MODEL'],
    enableTelegram: env['ENABLE_TELEGRAM'],
    enableWeb: env['ENABLE_WEB'],
    enableTui: env['ENABLE_TUI'],
    webPort: env['WEB_PORT'],
    webApiKey: env['WEB_API_KEY'],
    enableScheduler: env['ENABLE_SCHEDULER'],
    webshareProxyUsername: env['WEBSHARE_PROXY_USERNAME'],
    webshareProxyPassword: env['WEBSHARE_PROXY_PASSWORD'],
    modelBalanced: env['MODEL_BALANCED'],
    modelDeep: env['MODEL_DEEP'],
    thinkingLevel: env['THINKING_LEVEL'],
    logLlmPayloads: env['LOG_LLM_PAYLOADS'],
    digestSchedule: env['DIGEST_SCHEDULE'],
    newsletterSchedule: env['NEWSLETTER_SCHEDULE'],
    trendingSchedule: env['TRENDING_SCHEDULE'],
    reminderCheckSchedule: env['REMINDER_CHECK_SCHEDULE'],
  });

  if (!result.success) {
    const errors = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  cachedConfig = result.data;
  return cachedConfig;
}

export function resetConfig(): void {
  cachedConfig = null;
}
