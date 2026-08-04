import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { HttpError, contextHeaders, createHttpClient } from "./index.ts";

const USER = "22222222-2222-4222-8222-222222222222";

/** Records every call and replays queued responses. */
function stubFetch(responses: Array<Response | (() => Promise<Response>)>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const queue = [...responses];
  const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = queue.shift();
    if (!next) throw new Error("stubFetch: no response queued");
    return typeof next === "function" ? next() : next;
  }) as unknown as typeof globalThis.fetch;
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("contextHeaders emits the headers services authorize on", () => {
  assert.deepEqual(contextHeaders({ userId: USER, requestId: "r1" }), {
    "x-user-id": USER,
    "x-request-id": "r1",
  });
  assert.deepEqual(contextHeaders({}), {});
});

test("joins base url and path, serializes query and body", async () => {
  const { fetchImpl, calls } = stubFetch([json({ ok: true })]);
  const http = createHttpClient({ baseUrl: "http://jobs-service:3002", fetch: fetchImpl });

  await http.post("/jobs", { company: "Acme" }, { userId: USER, query: { dryRun: true } });

  assert.equal(calls[0]?.url, "http://jobs-service:3002/jobs?dryRun=true");
  assert.equal(calls[0]?.init.method, "POST");
  assert.equal(calls[0]?.init.body, '{"company":"Acme"}');
  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.equal(headers["x-user-id"], USER);
  assert.equal(headers["content-type"], "application/json");
});

test("withContext binds the caller for subsequent requests", async () => {
  const { fetchImpl, calls } = stubFetch([json([])]);
  const http = createHttpClient({ baseUrl: "http://jobs-service:3002", fetch: fetchImpl });

  await http.withContext({ userId: USER, requestId: "r9" }).get("/jobs");

  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.equal(headers["x-user-id"], USER);
  assert.equal(headers["x-request-id"], "r9");
});

test("validates responses against the supplied schema", async () => {
  const { fetchImpl } = stubFetch([json({ id: "abc", count: "not-a-number" })]);
  const http = createHttpClient({ baseUrl: "http://svc:1", fetch: fetchImpl, retries: 0 });

  await assert.rejects(
    () => http.get("/thing", { schema: z.object({ id: z.string(), count: z.number() }) }),
    (err: HttpError) => err.code === "UPSTREAM_ERROR" && err.status === 502,
  );
});

test("maps an error envelope to its domain code", async () => {
  const { fetchImpl } = stubFetch([
    json({ error: { code: "NOT_FOUND", message: "job not found" } }, 404),
  ]);
  const http = createHttpClient({ baseUrl: "http://svc:1", fetch: fetchImpl });

  await assert.rejects(
    () => http.get("/jobs/missing"),
    (err: HttpError) =>
      err.code === "NOT_FOUND" && err.status === 404 && err.message === "job not found",
  );
});

test("does not retry a 404, retries a 503 then succeeds", async () => {
  const notFound = stubFetch([json({}, 404)]);
  const notFoundClient = createHttpClient({
    baseUrl: "http://svc:1",
    fetch: notFound.fetchImpl,
    retryBaseMs: 1,
  });
  await assert.rejects(() => notFoundClient.get("/a"));
  assert.equal(notFound.calls.length, 1);

  const flaky = stubFetch([json({}, 503), json({}, 503), json({ ok: true })]);
  const flakyClient = createHttpClient({
    baseUrl: "http://svc:1",
    fetch: flaky.fetchImpl,
    retryBaseMs: 1,
  });
  assert.deepEqual(await flakyClient.get("/a"), { ok: true });
  assert.equal(flaky.calls.length, 3);
});

test("POST is not retried by default (not idempotent)", async () => {
  const { fetchImpl, calls } = stubFetch([json({}, 503), json({ ok: true })]);
  const http = createHttpClient({ baseUrl: "http://svc:1", fetch: fetchImpl, retryBaseMs: 1 });

  await assert.rejects(() => http.post("/tasks", {}));
  assert.equal(calls.length, 1);
});

test("wraps transport failures as UPSTREAM_ERROR after exhausting retries", async () => {
  const { fetchImpl, calls } = stubFetch([
    () => Promise.reject(new Error("ECONNREFUSED")),
    () => Promise.reject(new Error("ECONNREFUSED")),
    () => Promise.reject(new Error("ECONNREFUSED")),
  ]);
  const http = createHttpClient({ baseUrl: "http://svc:1", fetch: fetchImpl, retryBaseMs: 1 });

  await assert.rejects(
    () => http.get("/a"),
    (err: HttpError) => err.code === "UPSTREAM_ERROR" && /ECONNREFUSED/.test(err.message),
  );
  assert.equal(calls.length, 3);
});

test("204 resolves to undefined without parsing a body", async () => {
  const { fetchImpl } = stubFetch([new Response(null, { status: 204 })]);
  const http = createHttpClient({ baseUrl: "http://svc:1", fetch: fetchImpl });

  assert.equal(await http.delete("/jobs/1", { userId: USER }), undefined);
});
