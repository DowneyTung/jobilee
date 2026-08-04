/**
 * Phase 5: server-sent events, gateway rate limiting, and observability.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { CreateTaskResponse, TaskStatus } from "@jobilee/shared-types";
import {
  GATEWAY,
  api,
  newUser,
  setScenario,
  sleep,
  waitForStack,
  type Session,
} from "./harness.ts";

interface StreamedEvent {
  status: TaskStatus;
  result?: string | null;
  error?: string | null;
}

/**
 * Reads an SSE stream the way the web client does — with fetch, so the token
 * travels in a header rather than the query string.
 */
async function readStream(
  session: Session,
  taskId: string,
  timeoutMs = 60_000,
): Promise<StreamedEvent[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const events: StreamedEvent[] = [];

  try {
    const response = await fetch(`${GATEWAY}/api/ai/tasks/${taskId}/stream`, {
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${session.token}`,
      },
      signal: controller.signal,
    });
    assert.equal(response.status, 200, "stream did not open");
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.ok(response.body, "stream had no body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLine = raw.split("\n").find((line) => line.startsWith("data:"));
        if (dataLine) events.push(JSON.parse(dataLine.slice(5).trim()) as StreamedEvent);
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    clearTimeout(timer);
  }

  return events;
}

let session: Session;
let jobId: string;

before(async () => {
  await waitForStack();
  await setScenario("success");
  session = await newUser("hardening");
  const job = await api<{ id: string }>("/api/jobs", {
    method: "POST",
    token: session.token,
    body: { company: "Stream Co", title: "Engineer", jd: "Build streaming systems." },
  });
  jobId = job.id;
});

describe("server-sent events", () => {
  it("pushes the terminal result and closes, without the client polling", async () => {
    const { taskId } = await api<CreateTaskResponse>("/api/ai/tasks", {
      method: "POST",
      token: session.token,
      body: { type: "RESEARCH", input: { jobId, company: "Stream Co", title: "Engineer" } },
    });

    const events = await readStream(session, taskId);

    assert.ok(events.length > 0, "no events were received");
    const last = events.at(-1);
    assert.equal(last?.status, "SUCCEEDED");
    assert.match(last?.result ?? "", /## What they do/);
  });

  it("replays current state, so connecting after completion still returns the result", async () => {
    const { taskId } = await api<CreateTaskResponse>("/api/ai/tasks", {
      method: "POST",
      token: session.token,
      body: { type: "RESEARCH", input: { jobId, company: "Stream Co", title: "Engineer" } },
    });

    // Let it finish before opening the stream at all.
    await sleep(4_000);
    const events = await readStream(session, taskId);

    assert.equal(events.length, 1, "a settled task should replay once and close");
    assert.equal(events[0]?.status, "SUCCEEDED");
  });

  it("streams a failure with its user-facing message", async () => {
    await setScenario("refusal");
    const { taskId } = await api<CreateTaskResponse>("/api/ai/tasks", {
      method: "POST",
      token: session.token,
      body: { type: "RESEARCH", input: { jobId, company: "Stream Co", title: "Engineer" } },
    });

    const events = await readStream(session, taskId);
    const last = events.at(-1);

    assert.equal(last?.status, "FAILED");
    assert.match(last?.error ?? "", /declined/i);
    await setScenario("success");
  });

  it("SECURITY: another user cannot open a stream for someone else's task", async () => {
    const { taskId } = await api<CreateTaskResponse>("/api/ai/tasks", {
      method: "POST",
      token: session.token,
      body: { type: "RESEARCH", input: { jobId, company: "Stream Co", title: "Engineer" } },
    });

    const intruder = await newUser("streamintruder");
    const response = await fetch(`${GATEWAY}/api/ai/tasks/${taskId}/stream`, {
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${intruder.token}`,
      },
    });

    assert.equal(response.status, 404);
    await response.body?.cancel();
  });

  it("a stream requires a token", async () => {
    const response = await fetch(`${GATEWAY}/api/ai/tasks/${crypto.randomUUID()}/stream`, {
      headers: { accept: "text/event-stream" },
    });
    assert.equal(response.status, 401);
    await response.body?.cancel();
  });
});

describe("gateway rate limiting", () => {
  // These tests deliberately exhaust a shared per-IP bucket; wait it out so
  // the observability block below starts with a clean window.
  after(async () => {
    await sleep(6_000);
  });

  it("throttles the auth endpoints, which are the brute-force surface", async () => {
    // Each attempt costs an argon2 hash downstream, so the budget is small.
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) {
      const response = await fetch(`${GATEWAY}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "nobody@example.test", password: "wrong-password" }),
      });
      statuses.push(response.status);
      await response.body?.cancel();
    }

    assert.ok(statuses.includes(429), "the auth bucket never engaged");
    // Once limited, it stays limited for the window.
    assert.equal(statuses.at(-1), 429);
  });

  it("a limited response carries the headers a client needs to back off", async () => {
    const response = await fetch(`${GATEWAY}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.test", password: "wrong-password" }),
    });
    await response.body?.cancel();

    if (response.status === 429) {
      assert.ok(response.headers.get("retry-after"), "no Retry-After header");
      assert.equal(response.headers.get("ratelimit-remaining"), "0");
    }
    assert.ok(response.headers.get("ratelimit-limit"), "no RateLimit-Limit header");
  });

  it("returns the standard error envelope when limited", async () => {
    let body: { error?: { code?: string } } = {};
    for (let i = 0; i < 30; i++) {
      const response = await fetch(`${GATEWAY}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "nobody@example.test", password: "wrong-password" }),
      });
      const payload = (await response.json()) as { error?: { code?: string } };
      if (response.status === 429) {
        body = payload;
        break;
      }
    }
    assert.equal(body.error?.code, "RATE_LIMITED");
  });

  it("the auth bucket does not throttle ordinary API traffic", async () => {
    // A user hammering login must not lock themselves out of their own board.
    const user = await newUser("notlimited");
    for (let i = 0; i < 15; i++) {
      await api("/api/jobs", { token: user.token });
    }
  });

  it("health endpoints are never rate limited — containers depend on them", async () => {
    for (let i = 0; i < 40; i++) {
      const response = await fetch(`${GATEWAY}/health`);
      assert.equal(response.status, 200);
      await response.body?.cancel();
    }
  });
});

describe("observability", () => {
  it("exposes Prometheus metrics", async () => {
    const response = await fetch(`${GATEWAY}/metrics`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/plain/);

    const body = await response.text();
    assert.match(body, /# TYPE jobilee_gateway_requests_total counter/);
    assert.match(body, /jobilee_gateway_requests_total\{method="GET"/);
    assert.match(body, /jobilee_gateway_requests_in_flight/);
    assert.match(body, /jobilee_gateway_uptime_seconds/);
  });

  it("labels routes by shape, so ids never enter the label space", async () => {
    const job = await api<{ id: string }>("/api/jobs", {
      method: "POST",
      token: session.token,
      body: { company: "Metrics Co", title: "Engineer" },
    });
    await api(`/api/jobs/${job.id}`, { token: session.token });

    const body = await (await fetch(`${GATEWAY}/metrics`)).text();
    const routes = [...body.matchAll(/route="([^"]+)"/g)].map((m) => m[1]);

    assert.ok(routes.includes("/api/jobs/:id"), "the parameterised route is missing");
    assert.ok(
      !routes.some((route) => route?.includes(job.id)),
      "a job id leaked into a metric label",
    );
  });

  it("labels the gateway path, not the rewritten downstream path", async () => {
    // Reading the path after proxying would split one endpoint across two
    // series depending on whether the request was proxied or rejected first.
    const body = await (await fetch(`${GATEWAY}/metrics`)).text();
    const routes = [...body.matchAll(/route="([^"]+)"/g)].map((m) => m[1]);

    assert.ok(
      routes.some((route) => route?.startsWith("/api/")),
      "no gateway-side routes recorded",
    );
    assert.ok(
      !routes.includes("/jobs") && !routes.includes("/auth/login"),
      `downstream paths leaked into labels: ${routes.join(", ")}`,
    );
  });
});
