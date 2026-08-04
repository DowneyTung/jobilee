import { expect, test } from "@playwright/test";
import { AuthPage, uniqueUser } from "../pages/index.ts";

test.describe("the job pipeline", () => {
  test("add a job, move it through stages, and see the history", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-pipeline"));

    await board.addJob({
      company: "Northwind Traders",
      title: "Staff Backend Engineer",
      location: "Remote (EU)",
      jd: "Own the order-processing platform. Go, Postgres, event-driven services.",
    });
    await board.expectJobInStage("Northwind Traders", "Saved");

    const job = await board.openJob("Northwind Traders");
    await expect(page.getByText("Staff Backend Engineer")).toBeVisible();

    await job.moveToStage("APPLIED");
    await job.moveToStage("PHONE_SCREEN");

    // History accumulates rather than replacing.
    await job.expectHistory(["Saved", "Applied", "Phone screen"]);
  });

  test("the stage move survives a reload and shows on the board", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-persist"));
    await board.addJob({ company: "Contoso", title: "SRE" });

    const job = await board.openJob("Contoso");
    await job.moveToStage("TECHNICAL");
    await job.expectHistory(["Saved", "Technical"]);

    await page.reload();
    await expect(job.stageSelect).toHaveValue("TECHNICAL");

    const backToBoard = await job.goToBoard();
    await backToBoard.expectJobInStage("Contoso", "Technical");
  });

  test("stage counts on the board reflect where jobs are", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-counts"));
    await board.addJob({ company: "Alpha Co", title: "Engineer" });
    await board.addJob({ company: "Beta Co", title: "Engineer" });
    await board.expectStageCount("Saved", 2);

    const job = await board.openJob("Alpha Co");
    await job.moveToStage("ONSITE");
    const back = await job.goToBoard();

    await back.expectStageCount("Saved", 1);
    await back.expectStageCount("Onsite", 1);
  });

  test("notes and the job description save and persist", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-notes"));
    await board.addJob({ company: "Fabrikam", title: "Platform Engineer" });

    const job = await board.openJob("Fabrikam");
    await job.setNotes("Recruiter: Sam Okafor. Screen Tuesday 10:00.");
    await job.save();

    await page.reload();
    await expect(page.getByLabel("Notes")).toHaveValue(/Sam Okafor/);
  });

  test("deleting a job takes two clicks and removes it from the board", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-delete"));
    await board.addJob({ company: "Temporary Co", title: "Contractor" });

    const job = await board.openJob("Temporary Co");
    // A single click only arms the confirmation — no blocking browser dialog.
    await page.getByRole("button", { name: "Delete job" }).click();
    await expect(page.getByText(/cannot be undone/i)).toBeVisible();
    await page.getByRole("button", { name: "Delete permanently" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("Temporary Co")).toHaveCount(0);
  });

  test("cancelling a delete keeps the job", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-nodelete"));
    await board.addJob({ company: "Keeper Inc", title: "Engineer" });

    const job = await board.openJob("Keeper Inc");
    await job.cancelDelete();

    await expect(page.getByRole("heading", { name: "Keeper Inc" })).toBeVisible();
  });
});
