import { expect, test } from "@playwright/test";
import { AuthPage, uniqueUser } from "../pages/index.ts";
import { setScenario } from "./helpers.ts";

const JD = "Own the order-processing platform. Go, Postgres, event-driven services at scale.";

test.describe("AI generation from the job page", () => {
  test.beforeEach(async () => {
    await setScenario("success");
  });

  test("research runs, saves to the job, and survives a reload", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-research"));
    await board.addJob({ company: "Hooli", title: "Principal Engineer", jd: JD });
    const job = await board.openJob("Hooli");

    await job.generate("Research company");

    // Progress is reported rather than the button looking frozen for 40s.
    await expect(page.getByRole("status")).toContainText(/20–40 seconds/);

    await expect(job.researchArtifact).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("## What they do")).toBeVisible();

    // Persisted by jobs-service, not held in component state.
    await page.reload();
    await expect(job.researchArtifact).toBeVisible();
  });

  test("results arrive over SSE, not the polling fallback", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-sse"));
    await board.addJob({ company: "Streamy", title: "Engineer", jd: JD });
    const job = await board.openJob("Streamy");

    // A regression to polling still works, so only the network shape reveals it.
    const streamRequest = page.waitForRequest((request) =>
      /\/api\/ai\/tasks\/[0-9a-f-]+\/stream$/.test(request.url()),
    );

    await job.generate("Research company");
    const request = await streamRequest;

    expect(request.headers()["accept"]).toContain("text/event-stream");
    // The token rides in a header; a query string would leak it into history,
    // proxy logs, and Referer headers.
    expect(request.headers()["authorization"]).toMatch(/^Bearer /);
    expect(request.url()).not.toMatch(/token|jwt|authorization/i);

    await expect(job.researchArtifact).toBeVisible({ timeout: 45_000 });
  });

  test("tailoring writes a versioned resume", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-tailor"));

    const settings = await board.goToResumeSettings();
    await settings.setBaseResume("# Ada Lovelace\n\nAnalytical engines, 1843.");
    await settings.save();

    const backToBoard = await settings.goToBoard();
    await backToBoard.addJob({ company: "Initech", title: "Systems Engineer", jd: JD });
    const job = await backToBoard.openJob("Initech");

    await job.generate("Tailor resume");

    await expect(job.tailoredVersion(1)).toBeVisible({ timeout: 45_000 });
    await job.tailoredVersion(1).click();
    await expect(page.getByText("Tailored resume", { exact: false })).toBeVisible();
  });

  test("tailoring without a base resume tells you what to do instead of failing", async ({
    page,
  }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-noresume"));
    await board.addJob({ company: "Umbrella", title: "Researcher", jd: JD });
    const job = await board.openJob("Umbrella");

    await job.generate("Tailor resume");

    await expect(page.getByText(/Add your base resume/)).toBeVisible();
  });

  test("a refusal surfaces a readable message, not a stack trace", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-refusal"));
    await board.addJob({ company: "Globex", title: "Engineer", jd: JD });
    const job = await board.openJob("Globex");

    await setScenario("refusal");
    await job.generate("Research company");

    await expect(job.alert).toBeVisible({ timeout: 45_000 });
    await expect(job.alert).toContainText(/declined/i);
    await expect(job.alert).not.toContainText(/Error:|at .*\(/);
  });

  test("an upstream failure re-enables the buttons rather than leaving them stuck", async ({
    page,
  }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-recover"));
    await board.addJob({ company: "Soylent", title: "Engineer", jd: JD });
    const job = await board.openJob("Soylent");

    await setScenario("auth_error");
    await job.generate("Research company");
    await expect(job.alert).toBeVisible({ timeout: 45_000 });

    await expect(job.generateButton("Research company")).toBeEnabled();
  });

  test("interview prep is unavailable until a job description exists", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-nojd"));
    await board.addJob({ company: "Vandelay", title: "Importer" });
    const job = await board.openJob("Vandelay");

    await expect(job.generateButton("Interview prep")).toBeDisabled();
    await expect(page.getByText(/Paste the job description/)).toBeVisible();
  });
});
