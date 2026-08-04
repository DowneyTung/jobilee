import { baseEnvSchema, optionalUrl, parseEnv } from "@jobilee/service-kit";
import { z } from "zod";

const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3004),
  AI_DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  /**
   * The only place this key exists. It is never sent to the gateway or the
   * browser — that is the single biggest security gain over a client-side
   * prototype, where the key would be readable by anyone with devtools.
   */
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  /**
   * Overrides the API host. Set only by the test stack, which points it at a
   * mock speaking the Messages API — so the real SDK and our real streaming,
   * pause_turn, and error-classification code run under test.
   */
  ANTHROPIC_BASE_URL: optionalUrl,

  /** Model ids rotate; keep them in env, not in code. */
  AI_MODEL_GENERATION: z.string().min(1).default("claude-sonnet-5"),
  AI_MODEL_CHEAP: z.string().min(1).default("claude-haiku-4-5"),

  /** Concurrent generations per worker. Low, to respect API rate limits. */
  AI_WORKER_CONCURRENCY: z.coerce.number().int().positive().max(20).default(2),
  /** Per-user generations per UTC day, to bound cost. */
  AI_DAILY_TASK_CAP: z.coerce.number().int().positive().default(50),
  /** BullMQ attempts per job, including the first. */
  AI_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return parseEnv("ai-service", envSchema, env);
}
