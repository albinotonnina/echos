import { z } from 'zod';

const commaSeparatedNumbers = z
  .string()
  .transform((s) => s.split(',').map((id) => parseInt(id.trim(), 10)))
  .pipe(z.array(z.number().int().positive()));



export const configSchema = z
  .object({
  // Required
  telegramBotToken: z.string().optional(), // Required only when enableTelegram=true (checked at runtime)
  allowedUserIds: commaSeparatedNumbers,
  anthropicApiKey: z.string().min(1).optional(),

  // Optional
  openaiApiKey: z.string().optional(),

  // Multi-provider LLM support
  llmApiKey: z.string().min(1).optional(),
  llmBaseUrl: z.string().url().optional(),

  // Redis
  redisUrl: z.string().url().default('redis://localhost:6379'),

  // Storage paths
  knowledgeDir: z.string().default('./data/knowledge'),
  dbPath: z.string().default('./data/db'),
  sessionDir: z.string().default('./data/sessions'),

  // LLM
  defaultModel: z.string().default('claude-haiku-4-5-20251001'),
  embeddingModel: z.string().default('text-embedding-3-small'),
  embeddingDimensions: z.coerce.number().int().positive().default(1536),

  // Interfaces
  enableTelegram: z
    .string()
    .default('true')
    .transform((s) => s === 'true'),
  enableWeb: z
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
  thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).default('off'),

  // Prompt caching
  cacheRetention: z.enum(['none', 'short', 'long']).default('long'),

  // Debug
  logLlmPayloads: z
    .string()
    .default('false')
    .transform((s) => s === 'true'),
})
.superRefine((data, ctx) => {
  // Note: we intentionally do NOT validate that the API key matches DEFAULT_MODEL's provider here.
  // defaultModel has a schema-level default ('claude-haiku-4-5-20251001'), so we cannot distinguish
  // "user didn't set DEFAULT_MODEL" from "user set it to the default value" after parsing.
  // Mismatched key+model combos are caught at agent creation by pickApiKey() with a clear error.
  if (!data.anthropicApiKey && !data.llmApiKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one of ANTHROPIC_API_KEY or LLM_API_KEY must be set',
      path: ['anthropicApiKey'],
    });
  }
  if (data.llmBaseUrl && !data.llmApiKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'LLM_API_KEY must be set when LLM_BASE_URL is provided',
      path: ['llmApiKey'],
    });
  }
});

export type Config = z.infer<typeof configSchema>;

let cachedConfig: Config | null = null;

/** Treat empty strings as unset (undefined) so Zod `.optional()` handles them correctly. */
function emptyToUndefined(value: string | undefined): string | undefined {
  return value === '' ? undefined : value;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  if (cachedConfig) return cachedConfig;

  const e = (key: string): string | undefined => emptyToUndefined(env[key]);

  const result = configSchema.safeParse({
    telegramBotToken: e('TELEGRAM_BOT_TOKEN'),
    allowedUserIds: env['ALLOWED_USER_IDS'],
    anthropicApiKey: e('ANTHROPIC_API_KEY'),
    openaiApiKey: e('OPENAI_API_KEY'),
    llmApiKey: e('LLM_API_KEY'),
    llmBaseUrl: e('LLM_BASE_URL'),
    redisUrl: e('REDIS_URL'),
    knowledgeDir: e('KNOWLEDGE_DIR'),
    dbPath: e('DB_PATH'),
    sessionDir: e('SESSION_DIR'),
    defaultModel: e('DEFAULT_MODEL'),
    embeddingModel: e('EMBEDDING_MODEL'),
    embeddingDimensions: e('EMBEDDING_DIMENSIONS'),
    enableTelegram: e('ENABLE_TELEGRAM'),
    enableWeb: e('ENABLE_WEB'),
    webPort: e('WEB_PORT'),
    webApiKey: e('WEB_API_KEY'),
    enableScheduler: e('ENABLE_SCHEDULER'),
    webshareProxyUsername: e('WEBSHARE_PROXY_USERNAME'),
    webshareProxyPassword: e('WEBSHARE_PROXY_PASSWORD'),
    modelBalanced: e('MODEL_BALANCED'),
    modelDeep: e('MODEL_DEEP'),
    thinkingLevel: e('THINKING_LEVEL'),
    cacheRetention: e('CACHE_RETENTION'),
    logLlmPayloads: e('LOG_LLM_PAYLOADS'),
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
