import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LIMITS,
  interviewPrepPrompt,
  researchPrompt,
  resumeTailorPrompt,
  truncate,
} from "./prompts.ts";

const JOB_ID = "11111111-1111-4111-8111-111111111111";

test("truncate leaves short text alone and marks what it cut", () => {
  assert.equal(truncate("short", 100), "short");

  const long = "x".repeat(200);
  const cut = truncate(long, 50);
  assert.ok(cut.length < long.length);
  assert.match(cut, /truncated at 50 characters/);
  assert.ok(cut.startsWith("x".repeat(50)));
});

test("an oversized job description cannot blow the token budget", () => {
  // A pasted JD can be enormous; the prompt must stay bounded.
  const prompt = researchPrompt({
    jobId: JOB_ID,
    company: "Acme",
    title: "SWE",
    jd: "y".repeat(LIMITS.jd * 3),
  });
  assert.ok(prompt.user.length < LIMITS.jd * 1.2);
  assert.match(prompt.user, /truncated/);
});

test("an oversized resume is truncated too", () => {
  const prompt = resumeTailorPrompt({
    jobId: JOB_ID,
    company: "Acme",
    title: "SWE",
    jd: "short jd",
    baseResume: "z".repeat(LIMITS.baseResume * 2),
  });
  assert.ok(prompt.user.length < LIMITS.baseResume * 1.3);
});

test("only research asks for web search", () => {
  const common = { jobId: JOB_ID, company: "Acme", title: "SWE" };

  assert.equal(researchPrompt({ ...common, jd: "" }).webSearch, true);
  assert.equal(interviewPrepPrompt({ ...common, jd: "jd" }).webSearch, false);
  assert.equal(
    resumeTailorPrompt({ ...common, jd: "jd", baseResume: "resume" }).webSearch,
    false,
  );
});

test("research asks for the four documented sections", () => {
  const { system } = researchPrompt({ jobId: JOB_ID, company: "Acme", title: "SWE", jd: "" });

  for (const heading of [
    "## What they do",
    "## Recent news",
    "## Culture & values",
    "## Smart questions to ask",
  ]) {
    assert.ok(system.includes(heading), `missing ${heading}`);
  }
});

test("interview prep covers all four documented areas", () => {
  const { system } = interviewPrepPrompt({
    jobId: JOB_ID,
    company: "Acme",
    title: "SWE",
    jd: "Build things",
  });

  assert.match(system, /STAR/);
  assert.match(system, /Technical questions/i);
  assert.match(system, /watch-outs/i);
  assert.match(system, /Recruiter-call cheat sheet/i);
});

test("resume tailoring forbids inventing experience — the load-bearing instruction", () => {
  const { system } = resumeTailorPrompt({
    jobId: JOB_ID,
    company: "Acme",
    title: "SWE",
    jd: "Needs Kubernetes",
    baseResume: "Ada Lovelace, analytical engines",
  });

  assert.match(system, /NEVER invent experience/);
  assert.match(system, /reframe, reorder, and reword/);
  // The two sections resume-service splits the result on.
  assert.ok(system.includes("## Gap analysis"));
  assert.ok(system.includes("## Tailored resume"));
});

test("prompts carry the company and role into the user turn", () => {
  const prompt = researchPrompt({
    jobId: JOB_ID,
    company: "Northwind Traders",
    title: "Staff Engineer",
    jd: "",
  });
  assert.match(prompt.user, /Northwind Traders/);
  assert.match(prompt.user, /Staff Engineer/);
});

test("tailoring gets the largest output budget — it emits a whole resume", () => {
  const common = { jobId: JOB_ID, company: "Acme", title: "SWE" };
  const tailor = resumeTailorPrompt({ ...common, jd: "jd", baseResume: "resume" });
  const research = researchPrompt({ ...common, jd: "" });

  assert.ok(tailor.maxTokens > research.maxTokens);
});
