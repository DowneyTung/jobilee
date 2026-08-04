import { baseEnvSchema, parseEnv } from "@jobilee/service-kit";
import { z } from "zod";

const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3001),
  AUTH_DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(604_800),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return parseEnv("auth-service", envSchema, env);
}
