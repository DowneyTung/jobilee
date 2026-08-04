import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ERROR_STATUS,
  apiError,
  changeStageSchema,
  createJobSchema,
  createTaskSchema,
  isApiError,
  isTerminalStatus,
  registerRequestSchema,
  splitTailorResult,
  updateJobSchema,
} from "./index.ts";

test("register schema normalizes email and enforces password length", () => {
  const ok = registerRequestSchema.parse({ email: "  Ada@Example.COM ", password: "hunter22" });
  assert.equal(ok.email, "ada@example.com");

  assert.equal(registerRequestSchema.safeParse({ email: "nope", password: "hunter22" }).success, false);
  assert.equal(registerRequestSchema.safeParse({ email: "a@b.co", password: "short" }).success, false);
});

test("createJob applies defaults and rejects unknown stages", () => {
  const job = createJobSchema.parse({ company: "Acme", title: "SWE" });
  assert.equal(job.stage, "SAVED");
  assert.equal(job.jd, "");
  assert.equal(job.notes, "");

  assert.equal(changeStageSchema.safeParse({ stage: "ONSITE" }).success, true);
  assert.equal(changeStageSchema.safeParse({ stage: "COFFEE_CHAT" }).success, false);
});

test("updateJob rejects an empty patch", () => {
  assert.equal(updateJobSchema.safeParse({}).success, false);
  assert.equal(updateJobSchema.safeParse({ notes: "called back" }).success, true);
});

test("createTask discriminates input shape by task type", () => {
  const jobId = "11111111-1111-4111-8111-111111111111";
  assert.equal(
    createTaskSchema.safeParse({
      type: "RESEARCH",
      input: { jobId, company: "Acme", title: "SWE" },
    }).success,
    true,
  );
  // RESUME_TAILOR additionally requires jd + baseResume.
  assert.equal(
    createTaskSchema.safeParse({
      type: "RESUME_TAILOR",
      input: { jobId, company: "Acme", title: "SWE" },
    }).success,
    false,
  );
});

test("task terminality", () => {
  assert.equal(isTerminalStatus("SUCCEEDED"), true);
  assert.equal(isTerminalStatus("RUNNING"), false);
});

test("splitTailorResult separates the two sections", () => {
  const { gapAnalysis, content } = splitTailorResult(
    "## Gap analysis\nMissing Kubernetes.\n\n## Tailored resume\nAda Lovelace\n",
  );
  assert.equal(gapAnalysis, "Missing Kubernetes.");
  assert.equal(content, "Ada Lovelace");
});

test("splitTailorResult falls back to whole body when the heading is absent", () => {
  const { gapAnalysis, content } = splitTailorResult("just a resume");
  assert.equal(gapAnalysis, "");
  assert.equal(content, "just a resume");
});

test("api error helper produces the documented envelope", () => {
  const err = apiError("NOT_FOUND", "job not found", { requestId: "r1" });
  assert.equal(isApiError(err), true);
  assert.equal(ERROR_STATUS[err.error.code], 404);
});
