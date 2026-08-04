/**
 * Flows the user interrupts.
 *
 * This is the category that found the bug these tests were written for:
 * reloading mid-generation used to lose a result that had already been produced
 * and paid for, because the browser was doing the saving. Nothing here is
 * exotic — reloading, double-clicking, and navigating away are what impatient
 * people do to slow operations.
 */
import { expect, test } from "@playwright/test";
import { AuthPage, JobPage, uniqueUser } from "../pages/index.ts";
import { PDF, setScenario } from "./helpers.ts";

const JD = "Own the order-processing platform. Go, Postgres, distributed systems.";

test.describe("interrupted generations", () => {
  test.beforeEach(async () => {
    // Slow enough that the interruption lands while work is genuinely running.
    await setScenario("slow");
  });

  test("reloading mid-generation still saves the result", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-reload-gen"));
    await board.addJob({ company: "Reload Co", title: "Engineer", jd: JD });
    const job = await board.openJob("Reload Co");

    await job.generate("Research company");
    // Leave as soon as the work is definitely in flight.
    await page.waitForRequest((r) => /\/stream$/.test(r.url()));
    await page.reload();

    // ai-service delivers to jobs-service, so the result lands with no browser
    // involved. It is visible on the next load of the page.
    // Give the worker time to finish and deliver, then come back to the page.
    await page.waitForTimeout(10_000);
    await page.reload();
    await expect(job.researchArtifact).toBeVisible({ timeout: 20_000 });
  });

  test("navigating away mid-generation still saves the result", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-nav-gen"));
    await board.addJob({ company: "Navigate Co", title: "Engineer", jd: JD });
    const job = await board.openJob("Navigate Co");

    await job.generate("Research company");
    await page.waitForRequest((r) => /\/stream$/.test(r.url()));

    // Straight back to the board — the component that started the work is gone.
    const backToBoard = await job.goToBoard();
    const reopened = await backToBoard.openJob("Navigate Co");

    // Give the worker time to finish and deliver, then come back to the page.
    await page.waitForTimeout(10_000);
    await page.reload();
    await expect(reopened.researchArtifact).toBeVisible({ timeout: 20_000 });
  });

  test("signing out mid-generation does not lose the result", async ({ page }) => {
    const auth = new AuthPage(page);
    const user = uniqueUser("e2e-signout-gen");
    const board = await auth.register(user);
    await board.addJob({ company: "Signout Co", title: "Engineer", jd: JD });
    const job = await board.openJob("Signout Co");

    await job.generate("Research company");
    await page.waitForRequest((r) => /\/stream$/.test(r.url()));
    await job.signOut();

    // Let the worker finish while nobody is signed in at all.
    await page.waitForTimeout(10_000);

    // Signing back in returns to the page the bounce came from — the job —
    // rather than the board.
    await auth.signInReturningToPreviousPage(user);

    const reopened = new JobPage(page);
    await reopened.expectLoaded("Signout Co");
    // The work belongs to the account, not the session.
    await expect(reopened.researchArtifact).toBeVisible({ timeout: 20_000 });
  });

  test("a tailored version is saved even if the page is abandoned", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-abandon-tailor"));
    const settings = await board.goToResumeSettings();
    await settings.setBaseResume("# Grace Hopper\n\nCompilers.");
    await settings.save();

    const backToBoard = await settings.goToBoard();
    await backToBoard.addJob({ company: "Abandon Co", title: "Engineer", jd: JD });
    const job = await backToBoard.openJob("Abandon Co");

    await job.generate("Tailor resume");
    await page.waitForRequest((r) => /\/stream$/.test(r.url()));
    await page.reload();

    // Give the worker time to finish and deliver, then come back to the page.
    await page.waitForTimeout(10_000);
    await page.reload();
    await expect(job.tailoredVersion(1)).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("double submission", () => {
  test.beforeEach(async () => {
    await setScenario("success");
  });

  test.afterEach(async () => {
    await setScenario("success");
  });

  test("two fast clicks on Add job do not create two jobs", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-double-add"));

    await board.openAddJobForm();
    await page.getByLabel("Company").fill("Doubled Co");
    await page.getByLabel("Title").fill("Engineer");

    const submit = page.getByRole("button", { name: "Add job", exact: true }).last();
    await submit.click();
    // A second click lands before the first response settles.
    await submit.click({ force: true, timeout: 2_000 }).catch(() => undefined);

    await expect(board.jobCard("Doubled Co")).toBeVisible();
    await expect(page.getByText("Doubled Co")).toHaveCount(1);
  });

  test("the generation buttons disable while work is in flight", async ({ page }) => {
    // Instant completion would make this assertion vacuous.
    await setScenario("slow");
    const board = await new AuthPage(page).register(uniqueUser("e2e-double-gen"));
    await board.addJob({ company: "Once Co", title: "Engineer", jd: JD });
    const job = await board.openJob("Once Co");

    await job.generate("Research company");

    // All three, not just the one clicked — a second concurrent generation
    // would spend quota twice for one intent.
    await job.expectGenerationBusy();

    await expect(job.researchArtifact).toBeVisible({ timeout: 45_000 });
    await job.expectGenerationIdle();
  });

  test("saving notes twice in quick succession settles correctly", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-double-save"));
    await board.addJob({ company: "Save Co", title: "Engineer" });
    const job = await board.openJob("Save Co");

    await job.setNotes("first");
    await page.getByRole("button", { name: "Save changes" }).click();
    await job.setNotes("second");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Notes")).toHaveValue("second");
  });
});

test.describe("interrupted uploads", () => {
  test("navigating away after an upload keeps the file", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-upload-nav"));
    const settings = await board.goToResumeSettings();

    await settings.fileInput.setInputFiles({
      name: "kept.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await expect(settings.fileRow("kept.pdf")).toBeVisible();

    const backToBoard = await settings.goToBoard();
    const backToSettings = await backToBoard.goToResumeSettings();
    await expect(backToSettings.fileRow("kept.pdf")).toBeVisible();
  });
});
