import assert from "node:assert/strict";
import { test } from "node:test";
import type { Config } from "./config.ts";
import { buildRoutes, isPublicRoute } from "./routes.ts";

const baseConfig = {
  AUTH_SERVICE_URL: "http://auth-service:3001",
  JOBS_SERVICE_URL: "http://jobs-service:3002",
  RESUME_SERVICE_URL: "http://resume-service:3003",
  AI_SERVICE_URL: "http://ai-service:3004",
} as Config;

test("public routes are an allow-list, matched on method and exact path", () => {
  assert.equal(isPublicRoute("POST", "/api/auth/login"), true);
  assert.equal(isPublicRoute("post", "/api/auth/login"), true, "method compare is case-insensitive");
  assert.equal(isPublicRoute("POST", "/api/auth/register"), true);
  assert.equal(isPublicRoute("POST", "/api/auth/refresh"), true);
});

test("anything not on the allow-list is protected — the fail-closed property", () => {
  // A route added in a later phase must require a token by default.
  assert.equal(isPublicRoute("GET", "/api/auth/me"), false);
  assert.equal(isPublicRoute("GET", "/api/jobs"), false);
  assert.equal(isPublicRoute("POST", "/api/ai/tasks"), false);
  assert.equal(isPublicRoute("GET", "/api/resume/base"), false);
  // Same path, wrong method.
  assert.equal(isPublicRoute("GET", "/api/auth/login"), false);
  // Prefix games must not open a public route.
  assert.equal(isPublicRoute("POST", "/api/auth/login/../jobs"), false);
  assert.equal(isPublicRoute("POST", "/api/auth/loginx"), false);
});

test("only configured services get routed", () => {
  const routes = buildRoutes(baseConfig);
  assert.deepEqual(
    routes.map((r) => r.prefix),
    ["/api/auth", "/api/jobs", "/api/resume", "/api/ai"],
  );
});

test("an unset service is left unregistered rather than routed to nothing", () => {
  const routes = buildRoutes({ ...baseConfig, AI_SERVICE_URL: undefined, RESUME_SERVICE_URL: undefined });
  assert.deepEqual(
    routes.map((r) => r.prefix),
    ["/api/auth", "/api/jobs"],
  );
});

test("each route rewrites its gateway prefix to the service's own path", () => {
  const byPrefix = new Map(buildRoutes(baseConfig).map((r) => [r.prefix, r]));

  assert.equal(byPrefix.get("/api/auth")?.rewriteTo, "/auth");
  assert.equal(byPrefix.get("/api/jobs")?.rewriteTo, "/jobs");
  assert.equal(byPrefix.get("/api/resume")?.rewriteTo, "/resume");
  assert.equal(byPrefix.get("/api/ai")?.rewriteTo, "/ai");
});
