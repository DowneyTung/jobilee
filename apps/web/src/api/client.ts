import { isApiError, type ErrorCode } from "@jobilee/shared-types";
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
} from "./tokens.ts";

const API_BASE: string = import.meta.env["VITE_API_BASE"] ?? "http://localhost:8080/api";

/** Server-side failure, already unwrapped from the `{ error: … }` envelope. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | "NETWORK",
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Internal: prevents a refresh loop when the refresh call itself 401s. */
  skipRefresh?: boolean;
}

/**
 * Concurrent 401s share one refresh attempt. Without this, a dashboard firing
 * four queries on load would trigger four refreshes and race to overwrite each
 * other's access token.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        clearTokens();
        return false;
      }
      const data = (await response.json()) as { accessToken: string };
      setAccessToken(data.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so callers awaiting this promise all observe
      // the same result before a new attempt can start.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();

  return refreshInFlight;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, skipRefresh = false } = options;

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { accept: "application/json" };
    const token = getAccessToken();
    if (token) headers["authorization"] = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    return fetch(`${API_BASE}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };

  let response: Response;
  try {
    response = await send();
  } catch (cause) {
    throw new ApiError("NETWORK", "cannot reach the server", 0, cause);
  }

  // An expired access token is the common case, not an error — refresh once
  // and replay the request transparently.
  if (response.status === 401 && !skipRefresh && (await refreshAccessToken())) {
    response = await send();
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    if (isApiError(payload)) {
      throw new ApiError(
        payload.error.code,
        payload.error.message,
        response.status,
        payload.error.details,
      );
    }
    throw new ApiError("INTERNAL", `request failed (${response.status})`, response.status);
  }

  return payload as T;
}
