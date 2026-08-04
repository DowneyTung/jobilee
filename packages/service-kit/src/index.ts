/**
 * Shared NestJS glue for the backend services: the error envelope, the JSON
 * logger bridge, zod validation, the trusted user-id decorator, and env
 * parsing. Extracted once three services needed the same 40 lines.
 */
export * from "./bootstrap.ts";
export * from "./env.ts";
export * from "./errors.ts";
export * from "./nest-logger.ts";
export * from "./user-id.decorator.ts";
export * from "./zod.pipe.ts";
