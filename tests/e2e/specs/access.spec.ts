/**
 * Deep links, other people's data, and expired sessions — the ways a URL gets
 * used that the happy path never exercises.
 */
import { expect, test } from "@playwright/test";
import { AuthPage, BoardPage, JobPage, uniqueUser } from "../pages/index.ts";

test.describe("deep links", () => {
  test("a job id that does not exist shows an error, not a blank page", async ({ page }) => {
    await new AuthPage(page).register(uniqueUser("e2e-missing"));

    await page.goto(`/jobs/${crypto.randomUUID()}`);

    await expect(page.getByRole("alert")).toBeVisible();
    // And a way back, rather than a dead end.
    await expect(page.getByRole("link", { name: /Back to the board/ })).toBeVisible();
  });

  test("SECURITY: another user's job is not readable by URL", async ({ browser }) => {
    // Two isolated contexts so the sessions cannot share storage.
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const ownerBoard = await new AuthPage(ownerPage).register(uniqueUser("e2e-owner"));
    await ownerBoard.addJob({ company: "Confidential Co", title: "Engineer" });
    await ownerBoard.openJob("Confidential Co");
    const privateUrl = ownerPage.url();

    const intruderContext = await browser.newContext();
    const intruderPage = await intruderContext.newPage();
    await new AuthPage(intruderPage).register(uniqueUser("e2e-intruder"));

    await intruderPage.goto(privateUrl);

    await expect(intruderPage.getByRole("alert")).toBeVisible();
    await expect(intruderPage.getByText("Confidential Co")).toHaveCount(0);

    await ownerContext.close();
    await intruderContext.close();
  });

  test("a malformed job id is handled", async ({ page }) => {
    await new AuthPage(page).register(uniqueUser("e2e-malformed"));

    await page.goto("/jobs/not-a-uuid");

    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("an unknown route returns to the board rather than a blank screen", async ({ page }) => {
    await new AuthPage(page).register(uniqueUser("e2e-unknown"));

    await page.goto("/this/route/does/not/exist");

    await expect(page).toHaveURL(/\/$/);
    await new BoardPage(page).expectLoaded();
  });

  test("a deep link while signed out lands on login, not an error", async ({ page }) => {
    await page.goto(`/jobs/${crypto.randomUUID()}`);
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("session expiry", () => {
  test("an expired access token is refreshed transparently mid-session", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-expiry"));
    await board.addJob({ company: "Longlived Co", title: "Engineer" });

    // A reload discards the in-memory access token, leaving only the refresh
    // token — the same state an expiry produces. The app must recover without
    // bouncing the user to login.
    await page.reload();

    await board.expectLoaded();
    await expect(board.jobCard("Longlived Co")).toBeVisible();
  });

  test("a wiped refresh token sends the next navigation to login", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-wiped"));
    await board.expectLoaded();

    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page).toHaveURL(/\/login$/);
  });

  test("a corrupted refresh token does not wedge the app", async ({ page }) => {
    await new AuthPage(page).register(uniqueUser("e2e-corrupt"));

    await page.evaluate(() => localStorage.setItem("jobilee.refreshToken", "garbage.not.a.jwt"));
    await page.reload();

    // Rejected cleanly rather than looping or hanging on the restore screen.
    await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
  });
});

test.describe("browser navigation", () => {
  test("back and forward move between board and job without losing state", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-history"));
    await board.addJob({ company: "History Co", title: "Engineer" });
    const job = await board.openJob("History Co");
    await job.moveToStage("APPLIED");

    await page.goBack();
    await board.expectLoaded();
    await board.expectJobInStage("History Co", "Applied");

    await page.goForward();
    const reopened = new JobPage(page);
    await reopened.expectLoaded("History Co");
    // Through the page object: a bare getByLabel("Stage") also matches the
    // "Stage history" list.
    await expect(reopened.stageSelect).toHaveValue("APPLIED");
  });
});
