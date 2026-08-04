import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { USER_ID_HEADER } from "@jobilee/shared-types";
import type { Request } from "express";
import { AppError } from "./errors.ts";

/**
 * Reads the caller's id from the header the gateway injects after verifying
 * the JWT. The gateway strips any inbound copy, so this value is trusted —
 * that trust is the reason services must never be exposed directly.
 */
export const UserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<Request>();
  const userId = request.header(USER_ID_HEADER);
  if (!userId) {
    throw new AppError("UNAUTHORIZED", "missing user context");
  }
  return userId;
});
