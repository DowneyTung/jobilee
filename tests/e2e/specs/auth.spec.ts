import { expect, test } from "@playwright/test";
import { AuthPage, uniqueUser } from "../pages/index.ts";

test.describe("authentication", () => {
  test("an unauthenticated visitor is sent to the login screen", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Jobilee" })).toBeVisible();
  });

  test("register, then land on an empty board", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-register"));

    await expect(page).toHaveURL(/\/$/);
    await board.expectEmpty();
    await expect(page.getByRole("region", { name: "Pipeline stages" })).toBeVisible();
  });

  test("a wrong password shows an error and stays on the login screen", async ({ page }) => {
    const auth = new AuthPage(page);
    const user = uniqueUser("e2e-badpass");
    const board = await auth.register(user);
    await board.signOut();

    await auth.signInExpectingFailure({ ...user, password: "definitely-not-it" });

    await expect(auth.alert).toContainText(/invalid email or password/i);
    await expect(page).toHaveURL(/\/login$/);
  });

  test("the session survives a full page reload", async ({ page }) => {
    // The access token lives only in memory, so this exercises the refresh path.
    const board = await new AuthPage(page).register(uniqueUser("e2e-reload"));
    await page.reload();
    await board.expectLoaded();
  });

  test("signing out clears the session and protects the board", async ({ page }) => {
    const board = await new AuthPage(page).register(uniqueUser("e2e-signout"));
    await board.signOut();

    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("an existing account can sign back in", async ({ page }) => {
    const auth = new AuthPage(page);
    const user = uniqueUser("e2e-signin");
    const board = await auth.register(user);
    await board.signOut();

    await auth.signIn(user);
    await expect(page.getByText(user.email)).toBeVisible();
  });
});
