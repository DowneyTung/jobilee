import { expect, type Page } from "@playwright/test";

const MOCK_ANTHROPIC = process.env["MOCK_ANTHROPIC_URL"] ?? "http://localhost:4010";

export interface TestUser {
  email: string;
  password: string;
}

export function uniqueUser(prefix: string): TestUser {
  return {
    email: `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`,
    password: "e2e-test-password",
  };
}

/** Registers through the UI and lands on the board. */
export async function register(page: Page, user: TestUser): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("button", { name: "Add job" })).toBeVisible();
}

export async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("button", { name: "Add job" })).toBeVisible();
}

export interface JobFields {
  company: string;
  title: string;
  location?: string;
  jd?: string;
}

/** Adds a job from the board and returns to a state where it is visible. */
export async function addJob(page: Page, job: JobFields): Promise<void> {
  await page.getByRole("button", { name: "Add job" }).click();
  await page.getByLabel("Company").fill(job.company);
  await page.getByLabel("Title").fill(job.title);
  if (job.location) await page.getByLabel("Location").fill(job.location);
  if (job.jd) await page.getByLabel("Job description").fill(job.jd);

  await page.getByRole("button", { name: "Add job", exact: true }).last().click();
  await expect(page.getByRole("link", { name: new RegExp(job.company) })).toBeVisible();
}

export async function openJob(page: Page, company: string): Promise<void> {
  await page.getByRole("link", { name: new RegExp(company) }).click();
  await expect(page.getByRole("heading", { name: company })).toBeVisible();
}

/** Points the mock Anthropic API at a given behavior for the next generation. */
export async function setScenario(scenario: string): Promise<void> {
  const response = await fetch(`${MOCK_ANTHROPIC}/__control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario }),
  });
  if (!response.ok) throw new Error(`could not set mock scenario: ${scenario}`);
}
