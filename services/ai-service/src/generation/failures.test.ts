import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { AppError } from "@jobilee/service-kit";
import { describeFailure } from "./generation.service.ts";

/**
 * Retry classification is the difference between recovering from a blip and
 * burning quota — and money — on a failure that will never succeed.
 */

function apiError(status: number, type: string, message: string): unknown {
  return Anthropic.APIError.generate(
    status,
    { type: "error", error: { type, message } },
    message,
    new Headers(),
  );
}

test("rate limits are retryable", () => {
  const result = describeFailure(apiError(429, "rate_limit_error", "slow down"));
  assert.equal(result.retryable, true);
  assert.match(result.message, /busy/i);
});

test("server errors are retryable", () => {
  assert.equal(describeFailure(apiError(500, "api_error", "boom")).retryable, true);
  assert.equal(describeFailure(apiError(529, "overloaded_error", "overloaded")).retryable, true);
});

test("an auth error is NOT retryable — retrying it burns quota forever", () => {
  const result = describeFailure(apiError(401, "authentication_error", "invalid x-api-key"));
  assert.equal(result.retryable, false);
  assert.match(result.message, /not configured correctly/);
});

test("a bad request is not retryable", () => {
  assert.equal(describeFailure(apiError(400, "invalid_request_error", "bad")).retryable, false);
});

test("a refusal is terminal, not a transient failure", () => {
  const refusal = new AppError("BAD_REQUEST", "The model declined this request.");
  const result = describeFailure(refusal);
  assert.equal(result.retryable, false);
  assert.equal(result.message, "The model declined this request.");
});

test("connection failures are retryable", () => {
  const result = describeFailure(new Anthropic.APIConnectionError({ message: "socket hang up" }));
  assert.equal(result.retryable, true);
});

test("raw provider detail never reaches the user-facing message", () => {
  // Provider errors can carry request ids and internal detail; the UI gets none.
  const leaky = apiError(500, "api_error", "org_id=org_123 request_id=req_abc internal trace");
  const result = describeFailure(leaky);

  assert.doesNotMatch(result.message, /org_123|req_abc|trace/);
  assert.match(result.message, /Please try again/);
});

test("an unknown throwable degrades to a safe retryable message", () => {
  const result = describeFailure(new Error("something odd"));
  assert.equal(result.retryable, true);
  assert.doesNotMatch(result.message, /something odd/);
});
