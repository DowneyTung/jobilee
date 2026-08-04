import { expect, test } from "@playwright/test";
import { AuthPage, uniqueUser } from "../pages/index.ts";
import { PDF } from "./helpers.ts";

test.describe("resume and files", () => {
  test("the base resume saves and survives a reload", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-base"));
    const settings = await board.goToResumeSettings();

    await settings.setBaseResume("# Katherine Johnson\n\n## Experience\nNASA — trajectories.");
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    await settings.save();

    await page.reload();
    await expect(settings.resumeEditor).toHaveValue(/Katherine Johnson/);
  });

  test("uploading a PDF lists it, and it downloads back", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-upload"));
    const settings = await board.goToResumeSettings();

    await settings.fileInput.setInputFiles({
      name: "resume.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await expect(settings.fileRow("resume.pdf")).toBeVisible();

    // The download goes browser → MinIO via a freshly signed URL.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download" }).first().click(),
    ]);
    expect(download.suggestedFilename()).toBe("resume.pdf");
  });

  test("a wrong-type file is rejected with a readable message", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-badfile"));
    const settings = await board.goToResumeSettings();

    await settings.fileInput.setInputFiles({
      name: "malware.exe",
      mimeType: "application/x-msdownload",
      buffer: Buffer.from("MZ\x90\x00"),
    });

    await expect(settings.alert).toContainText(/unsupported file type/i);
  });

  test("deleting a file takes a confirmation and removes it from the list", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-filedelete"));
    const settings = await board.goToResumeSettings();

    await settings.fileInput.setInputFiles({
      name: "throwaway.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await expect(settings.fileRow("throwaway.pdf")).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).first().click();
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(settings.fileRow("throwaway.pdf")).toHaveCount(0);
    await settings.expectNoFiles();
  });

  test("files attached to a job are scoped to that job", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-jobfile"));
    await board.addJob({ company: "Acme", title: "Engineer" });

    const job = await board.openJob("Acme");
    await job.fileInput.setInputFiles({
      name: "application.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await expect(page.getByText("application.pdf")).toBeVisible();

    // The settings page lists unattached files, so it must not appear there.
    const settings = await job.goToResumeSettings();
    await settings.expectNoFiles();
  });
});
