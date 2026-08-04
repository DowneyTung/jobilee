/**
 * Non-page helpers. Everything that drives a screen lives in ../pages.
 */
const MOCK_ANTHROPIC = process.env["MOCK_ANTHROPIC_URL"] ?? "http://localhost:4010";

export type Scenario =
  | "success"
  | "pause_then_success"
  | "refusal"
  | "rate_limit_once"
  | "auth_error"
  | "server_error"
  | "truncated"
  | "empty"
  | "slow";

/** Points the mock Anthropic API at a given behavior for the next generation. */
export async function setScenario(scenario: Scenario): Promise<void> {
  const response = await fetch(`${MOCK_ANTHROPIC}/__control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario }),
  });
  if (!response.ok) throw new Error(`could not set mock scenario: ${scenario}`);
}

export const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);
