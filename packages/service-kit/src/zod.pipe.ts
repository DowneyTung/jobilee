import type { PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

/**
 * Validates a handler argument with a schema from `@jobilee/shared-types`, so
 * the contract the web app validates against is the same object the service
 * enforces. A failure throws ZodError, which the error filter renders as a
 * BAD_REQUEST with per-field details.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
