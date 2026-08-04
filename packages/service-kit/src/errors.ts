import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Logger } from "@jobilee/logger";
import { ERROR_STATUS, REQUEST_ID_HEADER, apiError, type ErrorCode } from "@jobilee/shared-types";
import type { Request, Response } from "express";
import { ZodError } from "zod";

/** Domain failure carrying the code the client will see. */
export class AppError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message, ERROR_STATUS[code]);
  }
}

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "RATE_LIMITED",
};

/**
 * Every failure leaves the service as `{ error: { code, message } }` — the one
 * shape the gateway and web client know how to read. Unexpected exceptions are
 * logged in full but reported as a generic INTERNAL so we never leak internals.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  constructor(private readonly log: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const requestId = request.header(REQUEST_ID_HEADER) ?? undefined;

    if (exception instanceof AppError) {
      response
        .status(exception.getStatus())
        .json(apiError(exception.code, exception.message, { details: exception.details, requestId }));
      return;
    }

    if (exception instanceof ZodError) {
      response.status(400).json(
        apiError("BAD_REQUEST", "request validation failed", {
          details: exception.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          requestId,
        }),
      );
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response
        .status(status)
        .json(apiError(STATUS_TO_CODE[status] ?? "INTERNAL", exception.message, { requestId }));
      return;
    }

    this.log.error("unhandled exception", exception, {
      method: request.method,
      path: request.path,
      requestId,
    });
    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json(apiError("INTERNAL", "internal server error", { requestId }));
  }
}
