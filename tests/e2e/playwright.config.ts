import { defineConfig, devices } from "@playwright/test";

/**
 * Runs against the already-running test stack (`make test-stack`), not against
 * a dev server Playwright starts itself — the app under test is the same
 * container image that ships, with a mocked Anthropic API behind it.
 */
export default defineConfig({
  testDir: "./specs",
  // Each spec registers its own user, so specs are independent — but the
  // shared mock's scenario is global state, so generation specs must not race.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env["WEB_URL"] ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
