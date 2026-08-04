import type { Request } from "express";

/**
 * Express request plus what the gateway attaches to it. Declared explicitly
 * rather than by global module augmentation, so the extra fields are visible
 * where they're used instead of appearing on every Request in the workspace.
 */
export interface GatewayRequest extends Request {
  userId?: string;
  requestId?: string;
}

export function asGatewayRequest(req: unknown): GatewayRequest {
  return req as GatewayRequest;
}
