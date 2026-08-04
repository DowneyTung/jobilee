import assert from "node:assert/strict";
import { test } from "node:test";
import { routeLabel } from "./observability.ts";

/**
 * Route labels become metric label values. Leaking an id into one turns a
 * single time series into one series per record — the standard way to melt a
 * metrics backend.
 */

test("uuids collapse to :id", () => {
  assert.equal(
    routeLabel("/api/jobs/11111111-1111-4111-8111-111111111111"),
    "/api/jobs/:id",
  );
  assert.equal(
    routeLabel("/api/jobs/11111111-1111-4111-8111-111111111111/stage"),
    "/api/jobs/:id/stage",
  );
  assert.equal(
    routeLabel("/api/ai/tasks/22222222-2222-4222-8222-222222222222/stream"),
    "/api/ai/tasks/:id/stream",
  );
});

test("several ids in one path all collapse", () => {
  assert.equal(
    routeLabel(
      "/api/jobs/11111111-1111-4111-8111-111111111111/artifacts/22222222-2222-4222-8222-222222222222",
    ),
    "/api/jobs/:id/artifacts/:id",
  );
});

test("uppercase uuids collapse too", () => {
  assert.equal(
    routeLabel("/api/jobs/AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"),
    "/api/jobs/:id",
  );
});

test("numeric segments collapse", () => {
  assert.equal(routeLabel("/api/resume/versions/42"), "/api/resume/versions/:n");
});

test("static paths are left alone", () => {
  for (const path of [
    "/api/jobs",
    "/api/auth/login",
    "/api/resume/base",
    "/api/ai/tasks",
    "/health",
    "/metrics",
  ]) {
    assert.equal(routeLabel(path), path);
  }
});

test("an artifact type is a bounded enum, so it stays readable", () => {
  // RESEARCH / INTERVIEW_PREP are a closed set — keeping them keeps the metric
  // useful without risking cardinality.
  assert.equal(
    routeLabel("/api/jobs/11111111-1111-4111-8111-111111111111/artifacts/RESEARCH"),
    "/api/jobs/:id/artifacts/RESEARCH",
  );
});
