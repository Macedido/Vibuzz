import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => (v == null || v === '' ? undefined : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8787),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGINS: z.string().default('*'),

  SUPABASE_URL: z.string().url(),
  /** Service role / secret key. Server only — never ship it in the app. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  /** Any OpenAI-compatible endpoint (OpenRouter, Groq, Together, local vLLM...). */
  COMPAT_API_KEY: z.string().optional(),
  COMPAT_BASE_URL: z.string().url().optional(),
  /** Google AI Studio key (free tier available). */
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com/v1beta/openai'),
  /**
   * Keyless free models (OVHcloud AI Endpoints anonymous tier + Pollinations) used
   * when no paid/keyed provider is configured, and as last-resort fallback.
   */
  FREE_AI: bool,
  OVH_BASE_URL: z.string().url().default('https://oai.endpoints.kepler.ai.cloud.ovh.net/v1'),
  OVH_API_KEY: z.string().optional(),
  POLLINATIONS_BASE_URL: z.string().url().default('https://text.pollinations.ai'),
  /** Free, keyless image model for character portraits. Set IMAGE_GEN=false to turn it off. */
  POLLINATIONS_IMAGE_URL: z.string().url().default('https://image.pollinations.ai'),
  IMAGE_GEN: bool,
  /** Run the classifier on every private chat message (default: only with a keyed provider). */
  MODERATE_PRIVATE_CHAT: bool,

  /** Comma-separated fallback chains: "provider:model,provider:model". */
  MODEL_FAST: z.string().optional(),
  MODEL_ADVANCED: z.string().optional(),
  MODEL_SPECIALIZED: z.string().optional(),
  MODEL_VISION: z.string().optional(),
  MODEL_EMBEDDING: z.string().optional(),
  MODERATION_PROVIDER: z.enum(['openai', 'llm', 'none']).optional(),
  /** JSON: {"provider:model": {"input": usdPerMTok, "output": usdPerMTok}} */
  MODEL_PRICING: z.string().optional(),

  DAILY_MESSAGE_LIMIT: z.coerce.number().default(400),
  DAILY_COST_LIMIT_USD: z.coerce.number().default(1.5),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().default(60),

  WORKER_ENABLED: bool,
  WORKER_CONCURRENCY: z.coerce.number().default(3),
  MESSAGE_PURGE_DAYS: z.coerce.number().default(30),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment. Check apps/api/.env (see .env.example):\n${issues}`);
  }
  return parsed.data;
}
