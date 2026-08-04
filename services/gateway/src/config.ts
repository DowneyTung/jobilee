import { baseEnvSchema, optionalUrl, parseEnv } from "@jobilee/service-kit";
import { z } from "zod";

const envSchema = baseEnvSchema.extend({
  GATEWAY_PORT: z.coerce.number().int().positive().default(8080),
  // Must match the secret auth-service signs with — the gateway verifies
  // tokens locally rather than calling auth-service on every request.
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  AUTH_SERVICE_URL: z.string().url(),
  // Unset or "" means "not wired up yet"; that route simply isn't registered.
  JOBS_SERVICE_URL: optionalUrl,
  RESUME_SERVICE_URL: optionalUrl,
  AI_SERVICE_URL: optionalUrl,
  /** Browser origin allowed by CORS. */
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return parseEnv("gateway", envSchema, env);
}
