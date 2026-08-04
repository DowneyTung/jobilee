import { baseEnvSchema, parseEnv } from "@jobilee/service-kit";
import { z } from "zod";

const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3002),
  JOBS_DATABASE_URL: z.string().url(),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return parseEnv("jobs-service", envSchema, env);
}
