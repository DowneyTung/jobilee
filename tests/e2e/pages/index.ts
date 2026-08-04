/**
 * Page objects for the four screens.
 *
 * Deliberately light. Playwright's role- and label-based locators already bind
 * to the accessibility tree rather than to markup, so the classic page-object
 * payoff — insulating tests from CSS churn — is largely collected before these
 * exist. What they add is one home for the selectors that were repeated across
 * specs, and methods that read as intent (`moveToStage`) rather than mechanics.
 *
 * Element getters per field are intentionally absent: they would double the
 * code without removing a single duplicated string.
 */
import { expect, type Locator, type Page } from "@playwright/test";

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

class BasePage {
  constructor(protected readonly page: Page) {}

  get signOutButton(): Locator {
    return this.page.getByRole("button", { name: "Sign out" });
  }

  async signOut(): Promise<void> {
    await this.signOutButton.click();
    await expect(this.page).toHaveURL(/\/login$/);
  }

  async goToResumeSettings(): Promise<SettingsPage> {
    await this.page.getByRole("link", { name: "Resume" }).click();
    const settings = new SettingsPage(this.page);
    await settings.expectLoaded();
    return settings;
  }

  async goToBoard(): Promise<BoardPage> {
    await this.page.getByRole("link", { name: "← Board" }).click();
    const board = new BoardPage(this.page);
    await board.expectLoaded();
    return board;
  }

  /** The single error region each screen uses for failures. */
  get alert(): Locator {
    return this.page.getByRole("alert");
  }
}

export class AuthPage extends BasePage {
  async gotoLogin(): Promise<void> {
    await this.page.goto("/login");
  }

  async gotoRegister(): Promise<void> {
    await this.page.goto("/register");
  }

  private async submit(user: TestUser, button: "Sign in" | "Create account"): Promise<void> {
    await this.page.getByLabel("Email").fill(user.email);
    await this.page.getByLabel("Password").fill(user.password);
    await this.page.getByRole("button", { name: button }).click();
  }

  async register(user: TestUser): Promise<BoardPage> {
    await this.gotoRegister();
    await this.submit(user, "Create account");
    const board = new BoardPage(this.page);
    await board.expectLoaded();
    return board;
  }

  async signIn(user: TestUser): Promise<BoardPage> {
    await this.gotoLogin();
    await this.submit(user, "Sign in");
    const board = new BoardPage(this.page);
    await board.expectLoaded();
    return board;
  }

  /**
   * Signs in without assuming where the app lands. After being bounced to
   * /login from a protected page, signing in returns you to that page rather
   * than the board — so callers that were mid-flow assert for themselves.
   */
  async signInReturningToPreviousPage(user: TestUser): Promise<void> {
    await this.gotoLogin();
    await this.submit(user, "Sign in");
    await expect(this.page).not.toHaveURL(/\/login$/);
  }

  /** Attempts a sign-in expected to fail, leaving the page on /login. */
  async signInExpectingFailure(user: TestUser): Promise<void> {
    await this.gotoLogin();
    await this.submit(user, "Sign in");
  }
}

export interface JobFields {
  company: string;
  title: string;
  location?: string;
  link?: string;
  jd?: string;
}

export class BoardPage extends BasePage {
  get addJobButton(): Locator {
    return this.page.getByRole("button", { name: "Add job" });
  }

  async expectLoaded(): Promise<void> {
    await expect(this.addJobButton).toBeVisible();
  }

  /** A stage column, located by its accessible name rather than a CSS class. */
  stageColumn(label: string): Locator {
    return this.page.getByRole("group", { name: new RegExp(`^${label} stage`) });
  }

  async expectJobInStage(company: string, stageLabel: string): Promise<void> {
    await expect(this.stageColumn(stageLabel).getByText(company)).toBeVisible();
  }

  async expectStageCount(stageLabel: string, count: number): Promise<void> {
    await expect(
      this.page.getByRole("group", {
        name: new RegExp(`^${stageLabel} stage, ${count} job`),
      }),
    ).toBeVisible();
  }

  async openAddJobForm(): Promise<void> {
    await this.addJobButton.click();
    await expect(this.page.getByLabel("Company")).toBeVisible();
  }

  async addJob(job: JobFields): Promise<void> {
    await this.openAddJobForm();
    await this.page.getByLabel("Company").fill(job.company);
    await this.page.getByLabel("Title").fill(job.title);
    if (job.location) await this.page.getByLabel("Location").fill(job.location);
    if (job.link) await this.page.getByLabel("Posting link").fill(job.link);
    if (job.jd) await this.page.getByLabel("Job description").fill(job.jd);
    await this.submitAddJobForm();
    await expect(this.jobCard(job.company)).toBeVisible();
  }

  /** The submit button inside the form, distinct from the header's toggle. */
  async submitAddJobForm(): Promise<void> {
    await this.page.getByRole("button", { name: "Add job", exact: true }).last().click();
  }

  jobCard(company: string): Locator {
    return this.page.getByRole("link", { name: new RegExp(company) });
  }

  async openJob(company: string): Promise<JobPage> {
    await this.jobCard(company).click();
    const job = new JobPage(this.page);
    await job.expectLoaded(company);
    return job;
  }

  async expectEmpty(): Promise<void> {
    await expect(this.page.getByText("No applications yet")).toBeVisible();
  }
}

export class JobPage extends BasePage {
  async expectLoaded(company: string): Promise<void> {
    await expect(this.page.getByRole("heading", { name: company })).toBeVisible();
  }

  get stageSelect(): Locator {
    // Exact, or this also matches the "Stage history" list.
    return this.page.getByLabel("Stage", { exact: true });
  }

  async moveToStage(stage: string): Promise<void> {
    await this.stageSelect.selectOption(stage);
  }

  /** History entries, located by the list's accessible name. */
  get historyEntries(): Locator {
    return this.page.getByRole("list", { name: "Stage history" }).getByRole("listitem");
  }

  async expectHistory(labels: string[]): Promise<void> {
    await expect(this.historyEntries).toHaveCount(labels.length);
    for (const [index, label] of labels.entries()) {
      await expect(this.historyEntries.nth(index)).toContainText(label);
    }
  }

  async setNotes(text: string): Promise<void> {
    await this.page.getByLabel("Notes").fill(text);
  }

  async setJobDescription(text: string): Promise<void> {
    await this.page.getByLabel("Job description").fill(text);
  }

  async save(): Promise<void> {
    await this.page.getByRole("button", { name: "Save changes" }).click();
    await expect(this.page.getByRole("button", { name: "Saved" })).toBeVisible();
  }

  // ---- AI ----------------------------------------------------------------

  get aiPanel(): Locator {
    return this.page.getByRole("region", { name: "AI assistance" });
  }

  generateButton(name: "Research company" | "Interview prep" | "Tailor resume"): Locator {
    return this.page.getByRole("button", { name });
  }

  async generate(name: "Research company" | "Interview prep" | "Tailor resume"): Promise<void> {
    await this.generateButton(name).click();
  }

  /**
   * Every generation button, located through the panel rather than by name:
   * the clicked button's label changes while work is in flight ("Research
   * company" becomes "Searching the web…"), so a name-based locator silently
   * stops matching the element it was asserting on.
   */
  get generationButtons(): Locator {
    return this.aiPanel.getByRole("button");
  }

  async expectGenerationBusy(): Promise<void> {
    const buttons = this.generationButtons;
    await expect(buttons).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(buttons.nth(i)).toBeDisabled();
    }
  }

  async expectGenerationIdle(): Promise<void> {
    await expect(this.generateButton("Research company")).toBeEnabled();
  }

  get researchArtifact(): Locator {
    return this.page.getByRole("button", { name: /Company research/ });
  }

  get prepArtifact(): Locator {
    return this.page.getByRole("button", { name: /Interview prep/ });
  }

  tailoredVersion(version: number): Locator {
    return this.page.getByRole("button", { name: new RegExp(`^v${version}`) });
  }

  // ---- files -------------------------------------------------------------

  get fileInput(): Locator {
    return this.page.getByRole("region", { name: "Files" }).locator('input[type="file"]');
  }

  // ---- danger zone -------------------------------------------------------

  async deleteJob(): Promise<void> {
    await this.page.getByRole("button", { name: "Delete job" }).click();
    await this.page.getByRole("button", { name: "Delete permanently" }).click();
    await expect(this.page).toHaveURL(/\/$/);
  }

  async cancelDelete(): Promise<void> {
    await this.page.getByRole("button", { name: "Delete job" }).click();
    await this.page.getByRole("button", { name: "Cancel" }).click();
  }
}

export class SettingsPage extends BasePage {
  get resumeEditor(): Locator {
    return this.page.getByLabel("Base resume");
  }

  async expectLoaded(): Promise<void> {
    await expect(this.resumeEditor).toBeVisible();
  }

  async setBaseResume(content: string): Promise<void> {
    await this.resumeEditor.fill(content);
  }

  async save(): Promise<void> {
    await this.page.getByRole("button", { name: "Save resume" }).click();
    await expect(this.page.getByText(/^Saved /)).toBeVisible();
  }

  get fileInput(): Locator {
    return this.page.locator('input[type="file"]');
  }

  fileRow(filename: string): Locator {
    return this.page.getByText(filename);
  }

  async expectNoFiles(): Promise<void> {
    await expect(this.page.getByText("No files yet.")).toBeVisible();
  }
}
