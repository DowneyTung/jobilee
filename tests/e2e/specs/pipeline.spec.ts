import { expect, test } from "@playwright/test";
import { addJob, openJob, register, uniqueUser } from "./helpers.ts";

test.describe("the job pipeline", () => {
  test("add a job, move it through stages, and see the history", async ({ page }) => {
    await register(page, uniqueUser("e2e-pipeline"));

    await addJob(page, {
      company: "Northwind Traders",
      title: "Staff Backend Engineer",
      location: "Remote (EU)",
      jd: "Own the order-processing platform. Go, Postgres, event-driven services.",
    });

    // The card lands in SAVED, and the column count reflects it.
    const savedColumn = page.locator(".stage").filter({ hasText: "SAVED" });
    await expect(savedColumn.getByText("Northwind Traders")).toBeVisible();

    await openJob(page, "Northwind Traders");
    await expect(page.getByText("Staff Backend Engineer")).toBeVisible();

    await page.getByLabel("Stage").selectOption("APPLIED");
    await expect(page.getByRole("listitem").filter({ hasText: "Applied" })).toBeVisible();

    await page.getByLabel("Stage").selectOption("PHONE_SCREEN");
    await expect(page.getByRole("listitem").filter({ hasText: "Phone screen" })).toBeVisible();

    // History accumulates rather than replacing.
    const history = page.locator(".timeline li");
    await expect(history).toHaveCount(3);
    await expect(history.nth(0)).toContainText("Saved");
    await expect(history.nth(2)).toContainText("Phone screen");
  });

  test("the stage move survives a reload and shows on the board", async ({ page }) => {
    await register(page, uniqueUser("e2e-persist"));
    await addJob(page, { company: "Contoso", title: "SRE" });
    await openJob(page, "Contoso");

    await page.getByLabel("Stage").selectOption("TECHNICAL");
    await expect(page.locator(".timeline li")).toHaveCount(2);

    await page.reload();
    await expect(page.getByLabel("Stage")).toHaveValue("TECHNICAL");

    await page.getByRole("link", { name: "← Board" }).click();
    const technical = page.locator(".stage").filter({ hasText: "TECHNICAL" });
    await expect(technical.getByText("Contoso")).toBeVisible();
  });

  test("notes and the job description save and persist", async ({ page }) => {
    await register(page, uniqueUser("e2e-notes"));
    await addJob(page, { company: "Fabrikam", title: "Platform Engineer" });
    await openJob(page, "Fabrikam");

    await page.getByLabel("Notes").fill("Recruiter: Sam Okafor. Screen Tuesday 10:00.");
    await page.getByRole("button", { name: "Save changes" }).click();

    // The button reverts to "Saved" once the edit is no longer dirty.
    await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Notes")).toHaveValue(/Sam Okafor/);
  });

  test("deleting a job takes two clicks and removes it from the board", async ({ page }) => {
    await register(page, uniqueUser("e2e-delete"));
    await addJob(page, { company: "Temporary Co", title: "Contractor" });
    await openJob(page, "Temporary Co");

    // A single click only arms the confirmation — no blocking browser dialog.
    await page.getByRole("button", { name: "Delete job" }).click();
    await expect(page.getByText(/cannot be undone/i)).toBeVisible();

    await page.getByRole("button", { name: "Delete permanently" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("Temporary Co")).toHaveCount(0);
  });

  test("cancelling a delete keeps the job", async ({ page }) => {
    await register(page, uniqueUser("e2e-nodelete"));
    await addJob(page, { company: "Keeper Inc", title: "Engineer" });
    await openJob(page, "Keeper Inc");

    await page.getByRole("button", { name: "Delete job" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("heading", { name: "Keeper Inc" })).toBeVisible();
  });
});
