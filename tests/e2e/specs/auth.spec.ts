import { expect, test } from "@playwright/test";
import { register, signIn, uniqueUser } from "./helpers.ts";

test.describe("authentication", () => {
  test("an unauthenticated visitor is sent to the login screen", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Jobilee" })).toBeVisible();
  });

  test("register, then land on an empty board", async ({ page }) => {
    await register(page, uniqueUser("e2e-register"));

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("No applications yet")).toBeVisible();
    // The pipeline rail is the app's core affordance.
    await expect(page.getByRole("region", { name: "Pipeline stages" })).toBeVisible();
  });

  test("a wrong password shows an error and stays on the login screen", async ({ page }) => {
    const user = uniqueUser("e2e-badpass");
    await register(page, user);
    await page.getByRole("button", { name: "Sign out" }).click();

    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toContainText(/invalid email or password/i);
    await expect(page).toHaveURL(/\/login$/);
  });

  test("the session survives a full page reload", async ({ page }) => {
    // The access token lives only in memory, so this exercises the refresh path.
    await register(page, uniqueUser("e2e-reload"));

    await page.reload();

    await expect(page.getByRole("button", { name: "Add job" })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("signing out clears the session and protects the board", async ({ page }) => {
    await register(page, uniqueUser("e2e-signout"));
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // A direct navigation must not get back in.
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("an existing account can sign back in", async ({ page }) => {
    const user = uniqueUser("e2e-signin");
    await register(page, user);
    await page.getByRole("button", { name: "Sign out" }).click();

    await signIn(page, user);
    await expect(page.getByText(user.email)).toBeVisible();
  });
});
