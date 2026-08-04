import assert from "node:assert/strict";
import { test } from "node:test";
import { noopLogger } from "@jobilee/logger";
import { REQUEST_ID_HEADER, USER_ID_HEADER } from "@jobilee/shared-types";
import type { NextFunction, Request, Response } from "express";
import { SignJWT } from "jose";
import type { Config } from "../config.ts";
import { createAuthMiddleware, requestIdMiddleware, stripInboundUserId } from "./identity.ts";

const SECRET = "test-secret-at-least-16-chars-long";
const KEY = new TextEncoder().encode(SECRET);
const USER = "11111111-1111-4111-8111-111111111111";

const config = { JWT_SECRET: SECRET } as Config;

async function signToken(options: {
  typ?: string;
  sub?: string;
  expiresInSeconds?: number;
  issuer?: string;
  audience?: string;
} = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: "ada@example.com", typ: options.typ ?? "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(options.sub ?? USER)
    .setIssuer(options.issuer ?? "jobilee-auth")
    .setAudience(options.audience ?? "jobilee")
    .setIssuedAt(now)
    .setExpirationTime(now + (options.expiresInSeconds ?? 900))
    .sign(KEY);
}

/** Minimal express req/res doubles — enough for the middlewares under test. */
function fakeReq(init: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
} = {}) {
  const headers: Record<string, string> = { ...init.headers };
  return {
    method: init.method ?? "GET",
    path: init.path ?? "/api/jobs",
    headers,
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request & { headers: Record<string, string> };
}

function fakeRes() {
  const state = { status: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(payload: unknown) {
      state.body = payload;
      return res;
    },
    setHeader(name: string, value: string) {
      state.headers[name] = value;
    },
  } as unknown as Response;
  return { res, state };
}

function nextSpy(): NextFunction & { called: boolean } {
  const fn = (() => {
    (fn as unknown as { called: boolean }).called = true;
  }) as NextFunction & { called: boolean };
  fn.called = false;
  return fn;
}

// ---- the load-bearing control -------------------------------------------

test("SECURITY: an inbound X-User-Id is always stripped", () => {
  const req = fakeReq({ headers: { [USER_ID_HEADER]: "22222222-2222-4222-8222-222222222222" } });
  const { res } = fakeRes();
  const next = nextSpy();

  stripInboundUserId(req, res, next);

  assert.equal(req.headers[USER_ID_HEADER], undefined);
  assert.equal(next.called, true);
});

test("SECURITY: stripping happens on every path, including public and unmatched ones", () => {
  // Downstream services trust this header absolutely, so there must be no
  // request shape — public route, unknown route, any method — that preserves it.
  for (const path of ["/api/auth/login", "/api/jobs", "/health", "/nonsense", "/"]) {
    for (const method of ["GET", "POST", "DELETE"]) {
      const req = fakeReq({ method, path, headers: { [USER_ID_HEADER]: "spoofed" } });
      const { res } = fakeRes();
      stripInboundUserId(req, res, nextSpy());
      assert.equal(req.headers[USER_ID_HEADER], undefined, `${method} ${path} leaked the header`);
    }
  }
});

// ---- correlation ---------------------------------------------------------

test("requestId is generated when absent and echoed on the response", () => {
  const req = fakeReq();
  const { res, state } = fakeRes();

  requestIdMiddleware(req, res, nextSpy());

  const id = req.headers[REQUEST_ID_HEADER];
  assert.match(String(id), /^[0-9a-f-]{36}$/);
  assert.equal(state.headers[REQUEST_ID_HEADER], id);
});

test("an inbound requestId is preserved, so a trace survives the hop", () => {
  const req = fakeReq({ headers: { [REQUEST_ID_HEADER]: "trace-abc" } });
  const { res, state } = fakeRes();

  requestIdMiddleware(req, res, nextSpy());

  assert.equal(req.headers[REQUEST_ID_HEADER], "trace-abc");
  assert.equal(state.headers[REQUEST_ID_HEADER], "trace-abc");
});

// ---- authentication ------------------------------------------------------

test("a valid access token injects the trusted X-User-Id", async () => {
  const authenticate = createAuthMiddleware(config, noopLogger);
  const req = fakeReq({ headers: { authorization: `Bearer ${await signToken()}` } });
  const { res } = fakeRes();
  const next = nextSpy();

  await authenticate(req, res, next);

  assert.equal(next.called, true);
  assert.equal(req.headers[USER_ID_HEADER], USER);
});

test("SECURITY: a spoofed header does not survive authentication", async () => {
  const authenticate = createAuthMiddleware(config, noopLogger);
  const spoof = "99999999-9999-4999-8999-999999999999";
  const req = fakeReq({
    headers: { authorization: `Bearer ${await signToken()}`, [USER_ID_HEADER]: spoof },
  });
  const { res } = fakeRes();

  stripInboundUserId(req, res, nextSpy());
  await authenticate(req, res, nextSpy());

  // The id comes from the verified token, never from what the caller sent.
  assert.equal(req.headers[USER_ID_HEADER], USER);
});

test("requests without a bearer token are rejected", async () => {
  const authenticate = createAuthMiddleware(config, noopLogger);
  const { res, state } = fakeRes();
  const next = nextSpy();

  await authenticate(fakeReq(), res, next);

  assert.equal(next.called, false);
  assert.equal(state.status, 401);
});

test("SECURITY: a refresh token is not accepted where an access token is required", async () => {
  const authenticate = createAuthMiddleware(config, noopLogger);
  const req = fakeReq({
    headers: { authorization: `Bearer ${await signToken({ typ: "refresh" })}` },
  });
  const { res, state } = fakeRes();
  const next = nextSpy();

  await authenticate(req, res, next);

  assert.equal(next.called, false);
  assert.equal(state.status, 401);
  assert.equal(req.headers[USER_ID_HEADER], undefined);
});

test("SECURITY: tokens signed with another key, expired, or misissued are rejected", async () => {
  const authenticate = createAuthMiddleware(config, noopLogger);

  const foreign = await new SignJWT({ email: "a@b.c", typ: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(USER)
    .setIssuer("jobilee-auth")
    .setAudience("jobilee")
    .setExpirationTime(Math.floor(Date.now() / 1000) + 900)
    .sign(new TextEncoder().encode("a-completely-different-secret-key"));

  const cases = [
    ["garbage", "not-a-jwt"],
    ["foreign signature", foreign],
    ["expired", await signToken({ expiresInSeconds: -60 })],
    ["wrong issuer", await signToken({ issuer: "somebody-else" })],
    ["wrong audience", await signToken({ audience: "another-app" })],
  ] as const;

  for (const [label, token] of cases) {
    const req = fakeReq({ headers: { authorization: `Bearer ${token}` } });
    const { res, state } = fakeRes();
    const next = nextSpy();

    await authenticate(req, res, next);

    assert.equal(next.called, false, `${label} was allowed through`);
    assert.equal(state.status, 401, `${label} did not 401`);
  }
});

test("public routes pass without a token, protected ones do not", async () => {
  const authenticate = createAuthMiddleware(config, noopLogger);

  const publicReq = fakeReq({ method: "POST", path: "/api/auth/login" });
  const publicNext = nextSpy();
  await authenticate(publicReq, fakeRes().res, publicNext);
  assert.equal(publicNext.called, true);

  const protectedNext = nextSpy();
  await authenticate(fakeReq({ path: "/api/jobs" }), fakeRes().res, protectedNext);
  assert.equal(protectedNext.called, false);
});

test("the gateway's own endpoints stay reachable — container healthchecks use them", async () => {
  const authenticate = createAuthMiddleware(config, noopLogger);

  for (const path of ["/health", "/ready"]) {
    const next = nextSpy();
    await authenticate(fakeReq({ path }), fakeRes().res, next);
    assert.equal(next.called, true, `${path} required a token`);
  }
});
