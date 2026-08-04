import { expect, test } from "@playwright/test";
import { addJob, openJob, register, uniqueUser } from "./helpers.ts";

const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

test.describe("resume and files", () => {
  test("the base resume saves and survives a reload", async ({ page }) => {
    await register(page, uniqueUser("e2e-base"));
    await page.getByRole("link", { name: "Resume" }).click();

    const content = "# Katherine Johnson\n\n## Experience\nNASA — trajectory analysis.";
    await page.getByLabel("Base resume").fill(content);

    await expect(page.getByText("Unsaved changes")).toBeVisible();
    await page.getByRole("button", { name: "Save resume" }).click();
    await expect(page.getByText(/^Saved /)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Base resume")).toHaveValue(/Katherine Johnson/);
  });

  test("uploading a PDF lists it, and it downloads back", async ({ page }) => {
    await register(page, uniqueUser("e2e-upload"));
    await page.getByRole("link", { name: "Resume" }).click();

    await page.locator('input[type="file"]').setInputFiles({
      name: "resume.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });

    await expect(page.getByText("resume.pdf")).toBeVisible();
    await expect(page.getByText(/\d+ B ·/)).toBeVisible();

    // The download goes browser → MinIO via a freshly signed URL.
    const download = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download" }).first().click(),
    ]).then(([d]) => d);

    expect(download.suggestedFilename()).toBe("resume.pdf");
  });

  test("an oversized or wrong-type file is rejected with a readable message", async ({ page }) => {
    await register(page, uniqueUser("e2e-badfile"));
    await page.getByRole("link", { name: "Resume" }).click();

    await page.locator('input[type="file"]').setInputFiles({
      name: "malware.exe",
      mimeType: "application/x-msdownload",
      buffer: Buffer.from("MZ\x90\x00"),
    });

    await expect(page.getByRole("alert")).toContainText(/unsupported file type/i);
  });

  test("deleting a file takes a confirmation and removes it from the list", async ({ page }) => {
    await register(page, uniqueUser("e2e-filedelete"));
    await page.getByRole("link", { name: "Resume" }).click();

    await page.locator('input[type="file"]').setInputFiles({
      name: "throwaway.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await expect(page.getByText("throwaway.pdf")).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).first().click();
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByText("throwaway.pdf")).toHaveCount(0);
    await expect(page.getByText("No files yet.")).toBeVisible();
  });

  test("files attached to a job are scoped to that job", async ({ page }) => {
    await register(page, uniqueUser("e2e-jobfile"));
    await addJob(page, { company: "Acme", title: "Engineer" });
    await openJob(page, "Acme");

    await page.locator('input[type="file"]').setInputFiles({
      name: "application.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await expect(page.getByText("application.pdf")).toBeVisible();

    // The settings page lists unattached files, so it must not appear there.
    await page.getByRole("link", { name: "Resume" }).click();
    await expect(page.getByText("No files yet.")).toBeVisible();
  });
});
