/**
 * Cross-service behavior through the gateway: authentication, the trust
 * boundary, the pipeline, and object storage. Everything a single service's
 * unit tests cannot prove on their own.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { USER_ID_HEADER, type Job, type JobDetail, type ResumeFile } from "@jobilee/shared-types";
import { api, newUser, waitForStack, type Session } from "./harness.ts";

before(async () => {
  await waitForStack();
});

describe("authentication", () => {
  it("register returns a session, and the tokens work", async () => {
    const session = await newUser("auth");
    const me = await api<{ user: { id: string; email: string } }>("/api/auth/me", {
      token: session.token,
    });
    assert.equal(me.user.id, session.userId);
  });

  it("a duplicate email is rejected as a conflict", async () => {
    const session = await newUser("dup");
    await api("/api/auth/register", {
      method: "POST",
      body: { email: session.email, password: "another-password" },
      expectStatus: 409,
    });
  });

  it("wrong password and unknown user are indistinguishable", async () => {
    const session = await newUser("timing");

    const wrongPassword = await api<{ error: { message: string } }>("/api/auth/login", {
      method: "POST",
      body: { email: session.email, password: "not-the-password" },
      expectStatus: 401,
    });
    const unknownUser = await api<{ error: { message: string } }>("/api/auth/login", {
      method: "POST",
      body: { email: "nobody-at-all@example.test", password: "not-the-password" },
      expectStatus: 401,
    });

    // Identical messages: the response must not confirm an account exists.
    assert.equal(wrongPassword.error.message, unknownUser.error.message);
  });

  it("a refresh token mints a new access token", async () => {
    const email = `refresh+${Date.now()}@example.test`;
    const registered = await api<{ refreshToken: string }>("/api/auth/register", {
      method: "POST",
      body: { email, password: "integration-test-password" },
    });

    const refreshed = await api<{ accessToken: string }>("/api/auth/refresh", {
      method: "POST",
      body: { refreshToken: registered.refreshToken },
    });

    const me = await api<{ user: { email: string } }>("/api/auth/me", {
      token: refreshed.accessToken,
    });
    assert.equal(me.user.email, email);
  });

  it("a refresh token is not accepted as an access token", async () => {
    const email = `swap+${Date.now()}@example.test`;
    const registered = await api<{ refreshToken: string }>("/api/auth/register", {
      method: "POST",
      body: { email, password: "integration-test-password" },
    });

    await api("/api/auth/me", { token: registered.refreshToken, expectStatus: 401 });
  });
});

describe("the trust boundary", () => {
  it("SECURITY: a forged X-User-Id header cannot impersonate anyone", async () => {
    const victim = await newUser("victim");
    await api("/api/jobs", {
      method: "POST",
      token: victim.token,
      body: { company: "Victim Corp", title: "Engineer" },
    });

    // No token, just the header downstream services trust.
    await api("/api/jobs", {
      headers: { [USER_ID_HEADER]: victim.userId },
      expectStatus: 401,
    });
  });

  it("SECURITY: a forged header alongside a valid token is ignored", async () => {
    const victim = await newUser("victim2");
    const attacker = await newUser("attacker");

    await api("/api/jobs", {
      method: "POST",
      token: victim.token,
      body: { company: "Victim Corp", title: "Engineer" },
    });

    // Valid token for the attacker; header claims to be the victim.
    const jobs = await api<Job[]>("/api/jobs", {
      token: attacker.token,
      headers: { [USER_ID_HEADER]: victim.userId },
    });

    assert.deepEqual(jobs, [], "the gateway must overwrite the inbound header");
  });

  it("protected routes reject requests without a token", async () => {
    for (const path of ["/api/jobs", "/api/resume/base", "/api/ai/quota", "/api/auth/me"]) {
      await api(path, { expectStatus: 401 });
    }
  });

  it("health endpoints stay public, for container healthchecks", async () => {
    const health = await fetch("http://localhost:8080/health");
    assert.equal(health.status, 200);
  });
});

describe("the job pipeline", () => {
  let session: Session;

  before(async () => {
    session = await newUser("pipeline");
  });

  it("a new job opens its history at SAVED", async () => {
    const job = await api<Job>("/api/jobs", {
      method: "POST",
      token: session.token,
      body: { company: "Contoso", title: "Backend Engineer", location: "Remote" },
    });
    assert.equal(job.stage, "SAVED");

    const detail = await api<JobDetail>(`/api/jobs/${job.id}`, { token: session.token });
    assert.equal(detail.events.length, 1);
    assert.equal(detail.events[0]?.stage, "SAVED");
  });

  it("each stage move appends a timestamped event", async () => {
    const job = await api<Job>("/api/jobs", {
      method: "POST",
      token: session.token,
      body: { company: "Fabrikam", title: "SRE" },
    });

    for (const stage of ["APPLIED", "PHONE_SCREEN", "OFFER"]) {
      await api(`/api/jobs/${job.id}/stage`, {
        method: "POST",
        token: session.token,
        body: { stage },
      });
    }

    const detail = await api<JobDetail>(`/api/jobs/${job.id}`, { token: session.token });
    assert.deepEqual(
      detail.events.map((e) => e.stage),
      ["SAVED", "APPLIED", "PHONE_SCREEN", "OFFER"],
    );
    assert.equal(detail.stage, "OFFER");
  });

  it("re-selecting the current stage does not duplicate history", async () => {
    const job = await api<Job>("/api/jobs", {
      method: "POST",
      token: session.token,
      body: { company: "Initech", title: "Analyst" },
    });
    await api(`/api/jobs/${job.id}/stage`, {
      method: "POST",
      token: session.token,
      body: { stage: "SAVED" },
    });

    const detail = await api<JobDetail>(`/api/jobs/${job.id}`, { token: session.token });
    assert.equal(detail.events.length, 1);
  });

  it("a stage sent through PATCH is ignored — moves must go through the stage route", async () => {
    const job = await api<Job>("/api/jobs", {
      method: "POST",
      token: session.token,
      body: { company: "Umbrella", title: "Researcher" },
    });

    const patched = await api<Job>(`/api/jobs/${job.id}`, {
      method: "PATCH",
      token: session.token,
      body: { stage: "OFFER", notes: "trying to skip history" },
    });

    assert.equal(patched.stage, "SAVED", "PATCH must not move the job");
    assert.equal(patched.notes, "trying to skip history");
  });

  it("one user's jobs are invisible to another", async () => {
    const other = await newUser("other");
    const mine = await api<Job>("/api/jobs", {
      method: "POST",
      token: session.token,
      body: { company: "Private Co", title: "Engineer" },
    });

    assert.deepEqual(await api<Job[]>("/api/jobs", { token: other.token }), []);
    await api(`/api/jobs/${mine.id}`, { token: other.token, expectStatus: 404 });
    await api(`/api/jobs/${mine.id}`, {
      method: "PATCH",
      token: other.token,
      body: { notes: "pwned" },
      expectStatus: 404,
    });
    await api(`/api/jobs/${mine.id}`, { method: "DELETE", token: other.token, expectStatus: 404 });
  });
});

describe("resumes and object storage", () => {
  let session: Session;

  before(async () => {
    session = await newUser("resume");
  });

  it("reading a base resume before writing one returns an empty document", async () => {
    const base = await api<{ content: string }>("/api/resume/base", { token: session.token });
    assert.equal(base.content, "");
  });

  it("the base resume round-trips", async () => {
    const content = "# Grace Hopper\n\nCOBOL, compilers, nanoseconds.";
    await api("/api/resume/base", { method: "PUT", token: session.token, body: { content } });

    const read = await api<{ content: string }>("/api/resume/base", { token: session.token });
    assert.equal(read.content, content);
  });

  it("tailored versions increment per job and list newest first", async () => {
    const job = await api<Job>("/api/jobs", {
      method: "POST",
      token: session.token,
      body: { company: "Versioned Co", title: "Engineer" },
    });

    for (const n of [1, 2, 3]) {
      await api("/api/resume/tailored", {
        method: "POST",
        token: session.token,
        body: { jobId: job.id, gapAnalysis: `gap ${n}`, content: `resume v${n}` },
      });
    }

    const versions = await api<Array<{ version: number }>>(
      `/api/resume/tailored?jobId=${job.id}`,
      { token: session.token },
    );
    assert.deepEqual(
      versions.map((v) => v.version),
      [3, 2, 1],
    );
  });

  it("a PDF uploads and downloads back byte-identical", async () => {
    const pdf = Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
    );
    const form = new FormData();
    form.append("file", new Blob([pdf], { type: "application/pdf" }), "resume.pdf");

    const uploaded = await fetch("http://localhost:8080/api/resume/files", {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
      body: form,
    });
    // Read the body once — consuming it for an assertion message would leave
    // nothing to parse.
    const uploadedBody = (await uploaded.json()) as ResumeFile;
    assert.equal(uploaded.status, 201, JSON.stringify(uploadedBody));
    const file = uploadedBody;
    assert.equal(file.size, pdf.byteLength);

    const signed = await api<{ url: string }>(`/api/resume/files/${file.id}`, {
      token: session.token,
    });
    // Signed for the browser-facing host, not the compose DNS name.
    assert.match(signed.url, /^http:\/\/localhost:9000\//);

    const downloaded = await fetch(signed.url);
    assert.equal(downloaded.status, 200);
    assert.ok(Buffer.from(await downloaded.arrayBuffer()).equals(pdf), "bytes differ");
  });

  it("an unsupported file type is rejected", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("MZ")], { type: "application/x-msdownload" }), "x.exe");

    const response = await fetch("http://localhost:8080/api/resume/files", {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
      body: form,
    });
    assert.equal(response.status, 400);
  });

  it("another user cannot get a signed URL for someone else's file", async () => {
    const pdf = Buffer.from("%PDF-1.4\ntrailer<</Root 1 0 R>>\n%%EOF\n");
    const form = new FormData();
    form.append("file", new Blob([pdf], { type: "application/pdf" }), "private.pdf");

    const uploaded = await fetch("http://localhost:8080/api/resume/files", {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
      body: form,
    });
    const file = (await uploaded.json()) as ResumeFile;

    const intruder = await newUser("fileintruder");
    await api(`/api/resume/files/${file.id}`, { token: intruder.token, expectStatus: 404 });
    assert.deepEqual(await api<ResumeFile[]>("/api/resume/files", { token: intruder.token }), []);
  });
});
