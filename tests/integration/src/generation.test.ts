/**
 * The AI pipeline, end to end against a mock Anthropic API.
 *
 * These are the paths that cannot be exercised with a real key without spending
 * money and waiting 40s — and the paths most likely to be wrong: the pause_turn
 * resume, refusal handling, retry classification, and the quota accounting.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MAX_JD_CHARS, type CreateTaskResponse, type JobDetail, type TailoredResume } from "@jobilee/shared-types";
import {
  api,
  awaitTask,
  clearRecordedRequests,
  newUser,
  recordedRequests,
  setScenario,
  waitForStack,
  type Session,
} from "./harness.ts";

let session: Session;
let jobId: string;

const JD = "Own the order pipeline. Go, Postgres, Kubernetes, on-call rotation.";

before(async () => {
  await waitForStack();
  session = await newUser("gen");
  const job = await api<{ id: string }>("/api/jobs", {
    method: "POST",
    token: session.token,
    body: { company: "Northwind Traders", title: "Staff Engineer", jd: JD },
  });
  jobId = job.id;
});

after(async () => {
  await setScenario("success");
});

describe("research generation", () => {
  it("runs to SUCCEEDED and returns the model's text", async () => {
    await setScenario("success");
    await clearRecordedRequests();

    const { taskId, status } = await api<CreateTaskResponse>("/api/ai/tasks", {
      method: "POST",
      token: session.token,
      body: {
        type: "RESEARCH",
        input: { jobId, company: "Northwind Traders", title: "Staff Engineer", jd: JD },
      },
    });
    assert.equal(status, "QUEUED", "the request must return before the work runs");

    const task = await awaitTask(session, taskId);
    assert.equal(task.status, "SUCCEEDED");
    assert.match(task.result ?? "", /## What they do/);
    assert.equal(task.error, null);
  });

  it("declares the web search tool, and only for research", async () => {
    await clearRecordedRequests();

    await awaitTask(
      session,
      (
        await api<CreateTaskResponse>("/api/ai/tasks", {
          method: "POST",
          token: session.token,
          body: { type: "RESEARCH", input: { jobId, company: "Acme", title: "SWE", jd: JD } },
        })
      ).taskId,
    );
    const [research] = await recordedRequests();
    assert.deepEqual(research?.toolTypes, ["web_search_20260209"]);

    await clearRecordedRequests();
    await awaitTask(
      session,
      (
        await api<CreateTaskResponse>("/api/ai/tasks", {
          method: "POST",
          token: session.token,
          body: { type: "INTERVIEW_PREP", input: { jobId, company: "Acme", title: "SWE", jd: JD } },
        })
      ).taskId,
    );
    const [prep] = await recordedRequests();
    assert.deepEqual(prep?.toolTypes, [], "interview prep must not search the web");
  });

  it("sends adaptive thinking and no sampling parameters", async () => {
    // temperature/top_p are rejected by the current models; sending them 400s.
    await clearRecordedRequests();
    await awaitTask(
      session,
      (
        await api<CreateTaskResponse>("/api/ai/tasks", {
          method: "POST",
          token: session.token,
          body: { type: "RESEARCH", input: { jobId, company: "Acme", title: "SWE", jd: "" } },
        })
      ).taskId,
    );

    const [request] = await recordedRequests();
    assert.deepEqual(request?.thinking, { type: "adaptive" });
    assert.equal(request?.hasSamplingParams, false);
  });
});

describe("pause_turn — the silent-truncation trap", () => {
  it("resumes a paused server-side tool loop instead of returning a partial brief", async () => {
    await setScenario("pause_then_success");
    await clearRecordedRequests();

    const { taskId } = await api<CreateTaskResponse>("/api/ai/tasks", {
      method: "POST",
      token: session.token,
      body: { type: "RESEARCH", input: { jobId, company: "Acme", title: "SWE", jd: JD } },
    });
    const task = await awaitTask(session, taskId);

    assert.equal(task.status, "SUCCEEDED");
    // The full answer, not the "Searching…" partial from the paused turn.
    assert.match(task.result ?? "", /## Smart questions to ask/);
    assert.doesNotMatch(task.result ?? "", /^Searching/);

    const requests = await recordedRequests();
    assert.equal(requests.length, 2, "the paused turn must be resumed with a second call");
  });
});

describe("failure handling", () => {
  it("a refusal fails the task with a user-facing message, not a stack trace", async () => {
    await setScenario("refusal");

    const { taskId } = await api<CreateTaskResponse>("/api/ai/tasks", {
      method: "POST",
      token: session.token,
      body: { type: "RESEARCH", input: { jobId, company: "Acme", title: "SWE", jd: JD } },
    });
    const task = await awaitTask(session, taskId);

    assert.equal(task.status, "FAILED");
    assert.match(task.error ?? "", /declined/i);
    assert.doesNotMatch(task.error ?? "", /Error:|at .*\(/, "no stack trace leaked to the user");
  });

  it("a rate limit is retried and then succeeds", async () => {
    await setScenario("rate_limit_once");
    await clearRecordedRequests();

    const { taskId } = await api<CreateTaskResponse>("/api/ai/tasks", {
      method: "POST",
      token: session.token,
      body: { type: "RESEARCH", input: { jobId, company: "Acme", title: "SWE", jd: JD } },
    });
    const task = await awaitTask(session, taskId, 90_000);

    assert.equal(task.status, "SUCCEEDED", "a 429 must not be terminal");
    assert.ok((await recordedRequests()).length >= 2, "the 429 should have been retried");
  });

  it("an auth error is terminal — it must not retry-storm", async () => {
    await setScenario("auth_error");
    await clearRecordedRequests();

    const { taskId } = await api<CreateTaskResponse>("/api/ai/tasks", {
      method: "POST",
      token: session.token,
      body: { type: "RESEARCH", input: { jobId, company: "Acme", title: "SWE", jd: JD } },
    });
    const task = await awaitTask(session, taskId);

    assert.equal(task.status, "FAILED");
    assert.match(task.error ?? "", /not configured correctly/);

    // The SDK retries internally, but the job must not be re-queued: a bad key
    // will never start working, and each attempt costs a request.
    const beforeWait = (await recordedRequests()).length;
    await new Promise((resolve) => setTimeout(resolve, 8_000));
    assert.equal((await recordedRequests()).length, beforeWait, "the job was retried after failing");
  });

  it("an empty response is reported rather than saved as a blank artifact", async () => {
    await setScenario("empty");

    const { taskId } = await api<CreateTaskResponse>("/api/ai/tasks", {
      method: "POST",
      token: session.token,
      body: { type: "RESEARCH", input: { jobId, company: "Acme", title: "SWE", jd: JD } },
    });
    const task = await awaitTask(session, taskId);

    assert.equal(task.status, "FAILED");
    assert.match(task.error ?? "", /empty/i);
  });
});

describe("prompt content reaching the model", () => {
  it("tailoring carries the no-invention rule and the base resume", async () => {
    await setScenario("success");
    await clearRecordedRequests();

    await api("/api/resume/base", {
      method: "PUT",
      token: session.token,
      body: { content: "# Ada Lovelace\n\nAnalytical engines, 1843." },
    });

    const { taskId } = await api<CreateTaskResponse>("/api/ai/tasks", {
      method: "POST",
      token: session.token,
      body: {
        type: "RESUME_TAILOR",
        input: {
          jobId,
          company: "Acme",
          title: "SWE",
          jd: JD,
          baseResume: "# Ada Lovelace\n\nAnalytical engines, 1843.",
        },
      },
    });
    await awaitTask(session, taskId);

    const [request] = await recordedRequests();
    assert.match(request?.system ?? "", /NEVER invent experience/);
    assert.match(request?.userText ?? "", /Analytical engines/);
    assert.match(request?.userText ?? "", /order pipeline/, "the job description must be included");
  });

  it("a job description beyond the contract limit is a clear 400, not an opaque error", async () => {
    // Express rejects bodies over its limit before any handler runs; without a
    // contract ceiling this surfaced as a 500 with no useful message.
    await api("/api/ai/tasks", {
      method: "POST",
      token: session.token,
      body: {
        type: "RESEARCH",
        input: { jobId, company: "Acme", title: "SWE", jd: "x".repeat(MAX_JD_CHARS + 1) },
      },
      expectStatus: 400,
    });
  });

  it("a large but legal job description is accepted and truncated before the API call", async () => {
    await setScenario("success");
    await clearRecordedRequests();

    // Comfortably under the contract ceiling, far over the prompt budget.
    const large = "lorem ipsum ".repeat(7_000);
    assert.ok(large.length < MAX_JD_CHARS);

    const { taskId } = await api<CreateTaskResponse>("/api/ai/tasks", {
      method: "POST",
      token: session.token,
      body: { type: "RESEARCH", input: { jobId, company: "Acme", title: "SWE", jd: large } },
    });
    const task = await awaitTask(session, taskId);
    assert.equal(task.status, "SUCCEEDED");

    const [request] = await recordedRequests();
    assert.ok(
      (request?.userText.length ?? 0) < 40_000,
      `prompt was ${request?.userText.length} chars — truncation did not apply`,
    );
    assert.match(request?.userText ?? "", /truncated/);
  });
});

describe("results are persisted by the service that owns them", () => {
  it("research is stored on the job, not in ai-service", async () => {
    await setScenario("success");

    const { taskId } = await api<CreateTaskResponse>("/api/ai/tasks", {
      method: "POST",
      token: session.token,
      body: { type: "RESEARCH", input: { jobId, company: "Acme", title: "SWE", jd: JD } },
    });
    const task = await awaitTask(session, taskId);

    // The web app performs this step after polling completes.
    await api(`/api/jobs/${jobId}/artifacts/RESEARCH`, {
      method: "PUT",
      token: session.token,
      body: { content: task.result },
    });

    const job = await api<JobDetail>(`/api/jobs/${jobId}`, { token: session.token });
    const research = job.artifacts.find((a) => a.type === "RESEARCH");
    assert.ok(research, "research artifact was not attached to the job");
    assert.match(research.content, /## What they do/);
  });

  it("a tailored resume becomes a new immutable version", async () => {
    const before = await api<TailoredResume[]>(`/api/resume/tailored?jobId=${jobId}`, {
      token: session.token,
    });

    await api("/api/resume/tailored", {
      method: "POST",
      token: session.token,
      body: { jobId, gapAnalysis: "Missing Kubernetes.", content: "# Ada Lovelace (tailored)" },
    });

    const after_ = await api<TailoredResume[]>(`/api/resume/tailored?jobId=${jobId}`, {
      token: session.token,
    });
    assert.equal(after_.length, before.length + 1);
    assert.equal(after_[0]?.version, before.length + 1, "versions must increment");
  });
});

describe("multi-tenancy and quota", () => {
  it("one user cannot poll another user's task", async () => {
    await setScenario("success");
    const intruder = await newUser("intruder");

    const { taskId } = await api<CreateTaskResponse>("/api/ai/tasks", {
      method: "POST",
      token: session.token,
      body: { type: "RESEARCH", input: { jobId, company: "Acme", title: "SWE", jd: JD } },
    });

    await api(`/api/ai/tasks/${taskId}`, {
      token: intruder.token,
      expectStatus: 404,
    });
  });

  it("a failed generation refunds the quota unit", async () => {
    const user = await newUser("quota");
    const job = await api<{ id: string }>("/api/jobs", {
      method: "POST",
      token: user.token,
      body: { company: "Acme", title: "SWE" },
    });

    const start = await api<{ remaining: number }>("/api/ai/quota", { token: user.token });

    await setScenario("auth_error");
    const { taskId } = await api<CreateTaskResponse>("/api/ai/tasks", {
      method: "POST",
      token: user.token,
      body: { type: "RESEARCH", input: { jobId: job.id, company: "Acme", title: "SWE" } },
    });
    await awaitTask(user, taskId);

    const end = await api<{ remaining: number }>("/api/ai/quota", { token: user.token });
    assert.equal(end.remaining, start.remaining, "a failure should not consume quota");
  });

  it("a successful generation does consume a quota unit", async () => {
    await setScenario("success");
    const user = await newUser("quota2");
    const job = await api<{ id: string }>("/api/jobs", {
      method: "POST",
      token: user.token,
      body: { company: "Acme", title: "SWE" },
    });

    const start = await api<{ remaining: number }>("/api/ai/quota", { token: user.token });
    const { taskId } = await api<CreateTaskResponse>("/api/ai/tasks", {
      method: "POST",
      token: user.token,
      body: { type: "RESEARCH", input: { jobId: job.id, company: "Acme", title: "SWE" } },
    });
    await awaitTask(user, taskId);

    const end = await api<{ remaining: number }>("/api/ai/quota", { token: user.token });
    assert.equal(end.remaining, start.remaining - 1);
  });
});
