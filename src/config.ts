import { z } from 'zod';
import { hasPricing } from './llm/pricing.js';
import { supportsRefusalFallback } from './llm/refusal-fallback.js';

const booleanFromString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .or(z.boolean());

/**
 * Every environment variable the service reads. Parsed once at startup:
 * a missing or invalid value stops the process before it accepts traffic.
 */
export const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    // Set to true only behind a reverse proxy you control (affects req.ip).
    TRUST_PROXY: booleanFromString.default(false),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'Must be a postgres:// URL' }),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    LLM_PROVIDER: z.enum(['anthropic', 'fake']),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    LLM_MODEL: z.string().min(1).default('claude-haiku-5-5'),
    LLM_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),
    LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(8192).default(2048),
    LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),
    // Transport-level retries done by the SDK (429/5xx/connection errors).
    LLM_MAX_TRANSPORT_RETRIES: z.coerce.number().int().min(0).max(5).default(1),
    // Server-side fallback to another model when the requested one declines.
    // Off by default: Haiku 5.5 has no server-side fallback.
    LLM_REFUSAL_FALLBACK: booleanFromString.default(false),

    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(60),
    DEFAULT_DAILY_TOKEN_BUDGET: z.coerce.number().int().min(1).default(200_000),
  })
  .superRefine((config, ctx) => {
    if (config.LLM_PROVIDER === 'anthropic' && config.ANTHROPIC_API_KEY === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['ANTHROPIC_API_KEY'],
        message: 'Required when LLM_PROVIDER=anthropic',
      });
    }
    if (config.LLM_PROVIDER === 'anthropic' && !hasPricing(config.LLM_MODEL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_MODEL'],
        message: 'No price configured for this model; add it to src/llm/pricing.ts',
      });
    }
    if (
      config.LLM_PROVIDER === 'anthropic' &&
      config.LLM_REFUSAL_FALLBACK &&
      !supportsRefusalFallback(config.LLM_MODEL)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_REFUSAL_FALLBACK'],
        message: 'The configured LLM_MODEL has no server-side refusal fallback; set this to false',
      });
    }
    if (config.NODE_ENV === 'production' && config.LLM_PROVIDER === 'fake') {
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_PROVIDER'],
        message: 'The fake provider is for development and tests only',
      });
    }
  });

export type Config = z.infer<typeof configSchema>;

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/**
 * Parses the environment. Error messages name the variables and the rule
 * they broke, never their values (they may be secrets).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // `KEY=` in a .env file means "not set", not "set to an empty string".
  const defined = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = configSchema.safeParse(defined);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Invalid configuration:\n${problems}`);
  }

  return result.data;
}
