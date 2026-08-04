/**
 * Shared helpers for the integration suite.
 *
 * These tests run against a live stack (`make test-stack`) — real Postgres,
 * Redis, and MinIO, real service processes, and a mock standing in for the
 * Anthropic API. Everything goes through the gateway, so the JWT verification
 * and X-User-Id injection are exercised on every call rather than bypassed.
 */
import assert from "node:assert/strict";
import { isTerminalStatus, type GenerationTask } from "@jobilee/shared-types";

export const GATEWAY = process.env["GATEWAY_URL"] ?? "http://localhost:8080";
export const MOCK_ANTHROPIC = process.env["MOCK_ANTHROPIC_URL"] ?? "http://localhost:4010";

export interface Session {
  token: string;
  userId: string;
  email: string;
}

export class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    /** Raw headers, for negative tests that forge things. */
    headers?: Record<string, string>;
    expectStatus?: number;
  } = {},
): Promise<T> {
  const { method = "GET", body, token, headers = {}, expectStatus } = options;

  const response = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const payload = response.status === 204 ? undefined : await response.json().catch(() => undefined);

  if (expectStatus !== undefined) {
    assert.equal(
      response.status,
      expectStatus,
      `${method} ${path} → ${response.status} (expected ${expectStatus}): ${JSON.stringify(payload)}`,
    );
    return payload as T;
  }

  if (!response.ok) {
    throw new HttpFailure(response.status, payload, `${method} ${path} failed: ${response.status}`);
  }
  return payload as T;
}

/**
 * Registers a throwaway user and returns a usable session.
 *
 * Registration shares the gateway's per-IP auth bucket with every other test,
 * so this backs off and retries on 429 the way a real client should, instead
 * of failing because a neighbouring test provoked the limiter.
 */
export async function newUser(prefix = "it"): Promise<Session> {
  const email = `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const registered = await api<{ accessToken: string; user: { id: string } }>(
        "/api/auth/register",
        { method: "POST", body: { email, password: "integration-test-password" } },
      );
      return { token: registered.accessToken, userId: registered.user.id, email };
    } catch (error) {
      if (!(error instanceof HttpFailure) || error.status !== 429) throw error;
      await sleep(1_500);
    }
  }
  throw new Error("could not register a test user — the rate limiter never released");
}

// ---- mock Anthropic control ---------------------------------------------

export type Scenario =
  | "success"
  | "pause_then_success"
  | "refusal"
  | "rate_limit_once"
  | "auth_error"
  | "server_error"
  | "truncated"
  | "empty"
  | "slow";

export async function setScenario(scenario: Scenario): Promise<void> {
  const response = await fetch(`${MOCK_ANTHROPIC}/__control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario }),
  });
  assert.ok(response.ok, `could not set mock scenario ${scenario}`);
}

export interface RecordedRequest {
  model: string;
  system: string;
  userText: string;
  toolTypes: string[];
  maxTokens: number;
  thinking: unknown;
  hasSamplingParams: boolean;
}

export async function recordedRequests(): Promise<RecordedRequest[]> {
  const response = await fetch(`${MOCK_ANTHROPIC}/__requests`);
  const body = (await response.json()) as { requests: RecordedRequest[] };
  return body.requests;
}

export async function clearRecordedRequests(): Promise<void> {
  await fetch(`${MOCK_ANTHROPIC}/__requests`, { method: "DELETE" });
}

// ---- polling -------------------------------------------------------------

/** Polls a generation task the way the web app does, until it settles. */
export async function awaitTask(
  session: Session,
  taskId: string,
  timeoutMs = 60_000,
): Promise<GenerationTask> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const task = await api<GenerationTask>(`/api/ai/tasks/${taskId}`, { token: session.token });
    if (isTerminalStatus(task.status)) return task;
    await sleep(400);
  }
  throw new Error(`task ${taskId} did not settle within ${timeoutMs}ms`);
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for the whole stack to answer, so tests don't race a cold start. */
export async function waitForStack(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const ready = await fetch(`${GATEWAY}/ready`);
      const mock = await fetch(`${MOCK_ANTHROPIC}/__health`);
      if (ready.ok && mock.ok) {
        const body = (await ready.json()) as { checks?: Record<string, string> };
        const down = Object.entries(body.checks ?? {}).filter(([, v]) => v !== "ok");
        if (down.length === 0) return;
        lastError = `downstream not ready: ${down.map(([k]) => k).join(", ")}`;
      }
    } catch (error) {
      lastError = String(error);
    }
    await sleep(1_000);
  }
  throw new Error(`stack not ready after ${timeoutMs}ms — ${lastError}. Run: make test-stack`);
}
