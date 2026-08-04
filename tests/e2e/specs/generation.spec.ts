import { expect, test } from "@playwright/test";
import { addJob, openJob, register, setScenario, uniqueUser } from "./helpers.ts";

const JD = "Own the order-processing platform. Go, Postgres, event-driven services at scale.";

test.describe("AI generation from the job page", () => {
  test.beforeEach(async () => {
    await setScenario("success");
  });

  test("research runs, saves to the job, and survives a reload", async ({ page }) => {
    await register(page, uniqueUser("e2e-research"));
    await addJob(page, { company: "Hooli", title: "Principal Engineer", jd: JD });
    await openJob(page, "Hooli");

    await page.getByRole("button", { name: "Research company" }).click();

    // The button reports progress rather than looking frozen for 40 seconds.
    await expect(page.getByRole("status")).toContainText(/20–40 seconds/);

    // Once saved, the brief appears in the artifacts section.
    await expect(page.getByRole("button", { name: /Company research/ })).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByText("## What they do")).toBeVisible();

    // Persisted by jobs-service, not held in component state.
    await page.reload();
    await expect(page.getByRole("button", { name: /Company research/ })).toBeVisible();
  });

  test("results arrive over SSE, not the polling fallback", async ({ page }) => {
    await register(page, uniqueUser("e2e-sse"));
    await addJob(page, { company: "Streamy", title: "Engineer", jd: JD });
    await openJob(page, "Streamy");

    // If this regresses to polling the app still works, so only the network
    // shape reveals it.
    const streamRequest = page.waitForRequest((request) =>
      /\/api\/ai\/tasks\/[0-9a-f-]+\/stream$/.test(request.url()),
    );

    await page.getByRole("button", { name: "Research company" }).click();
    const request = await streamRequest;

    expect(request.headers()["accept"]).toContain("text/event-stream");
    // The token rides in a header; putting it in the query string would leak it
    // into history, proxy logs, and Referer headers.
    expect(request.headers()["authorization"]).toMatch(/^Bearer /);
    expect(request.url()).not.toMatch(/token|jwt|authorization/i);

    await expect(page.getByRole("button", { name: /Company research/ })).toBeVisible({
      timeout: 45_000,
    });
  });

  test("tailoring writes a versioned resume", async ({ page }) => {
    const user = uniqueUser("e2e-tailor");
    await register(page, user);

    // Tailoring needs a base resume, so set one first.
    await page.getByRole("link", { name: "Resume" }).click();
    await page.getByLabel("Base resume").fill("# Ada Lovelace\n\nAnalytical engines, 1843.");
    await page.getByRole("button", { name: "Save resume" }).click();
    await expect(page.getByText(/^Saved /)).toBeVisible();

    await page.getByRole("link", { name: "← Board" }).click();
    await addJob(page, { company: "Initech", title: "Systems Engineer", jd: JD });
    await openJob(page, "Initech");

    await page.getByRole("button", { name: "Tailor resume" }).click();

    await expect(page.getByRole("button", { name: /^v1/ })).toBeVisible({ timeout: 45_000 });
    await page.getByRole("button", { name: /^v1/ }).click();
    await expect(page.getByText("Tailored resume", { exact: false })).toBeVisible();
  });

  test("tailoring without a base resume tells you what to do instead of failing", async ({
    page,
  }) => {
    await register(page, uniqueUser("e2e-noresume"));
    await addJob(page, { company: "Umbrella", title: "Researcher", jd: JD });
    await openJob(page, "Umbrella");

    await page.getByRole("button", { name: "Tailor resume" }).click();

    await expect(page.getByText(/Add your base resume/)).toBeVisible();
  });

  test("a refusal surfaces a readable message, not a stack trace", async ({ page }) => {
    await register(page, uniqueUser("e2e-refusal"));
    await addJob(page, { company: "Globex", title: "Engineer", jd: JD });
    await openJob(page, "Globex");

    await setScenario("refusal");
    await page.getByRole("button", { name: "Research company" }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 45_000 });
    await expect(alert).toContainText(/declined/i);
    await expect(alert).not.toContainText(/Error:|at .*\(/);
  });

  test("an upstream failure re-enables the buttons rather than leaving them stuck", async ({
    page,
  }) => {
    await register(page, uniqueUser("e2e-recover"));
    await addJob(page, { company: "Soylent", title: "Engineer", jd: JD });
    await openJob(page, "Soylent");

    await setScenario("auth_error");
    await page.getByRole("button", { name: "Research company" }).click();
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 45_000 });

    // A failed run must not permanently disable the panel.
    await expect(page.getByRole("button", { name: "Research company" })).toBeEnabled();
  });

  test("interview prep is unavailable until a job description exists", async ({ page }) => {
    await register(page, uniqueUser("e2e-nojd"));
    await addJob(page, { company: "Vandelay", title: "Importer" });
    await openJob(page, "Vandelay");

    await expect(page.getByRole("button", { name: "Interview prep" })).toBeDisabled();
    await expect(page.getByText(/Paste the job description/)).toBeVisible();
  });
});
