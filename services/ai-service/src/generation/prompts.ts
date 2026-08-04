import type {
  InterviewPrepInput,
  ResearchInput,
  ResumeTailorInput,
} from "@jobilee/shared-types";

/**
 * Input truncation budgets. A pasted job description can be enormous, and a
 * resume can be a whole career — cap both so one oversized input can't blow
 * the token budget (or the bill) for a single generation.
 */
export const LIMITS = {
  jd: 24_000,
  baseResume: 24_000,
} as const;

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[…truncated at ${max} characters]`;
}

export interface PromptSpec {
  system: string;
  user: string;
  /** Research needs live web results; the other two work from what's given. */
  webSearch: boolean;
  maxTokens: number;
}

export function researchPrompt(input: ResearchInput): PromptSpec {
  return {
    webSearch: true,
    maxTokens: 8_000,
    system: [
      "You are a research analyst preparing a candidate for a job interview.",
      "Search the web for current, specific information about the company — not",
      "generic filler. Prefer primary sources and recent reporting. If you cannot",
      "verify something, say so rather than guessing; an honest gap is more useful",
      "to a candidate than a confident invention.",
      "",
      "Respond in Markdown with exactly these sections, in this order:",
      "## What they do",
      "## Recent news",
      "## Culture & values",
      "## Smart questions to ask",
      "",
      "Under 'Smart questions to ask', give questions that show the candidate did",
      "real homework — grounded in the specific news and values you found, not",
      "questions that could be asked of any company.",
    ].join("\n"),
    user: [
      `Company: ${input.company}`,
      `Role: ${input.title}`,
      input.jd ? `\nJob description:\n${truncate(input.jd, LIMITS.jd)}` : "",
      "\nResearch this company for an upcoming interview.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function interviewPrepPrompt(input: InterviewPrepInput): PromptSpec {
  return {
    webSearch: false,
    maxTokens: 8_000,
    system: [
      "You are an interview coach. Prepare a candidate for a specific role,",
      "grounding every item in the job description you are given rather than in",
      "generic interview advice.",
      "",
      "Respond in Markdown with exactly these sections, in this order:",
      "## Likely behavioral questions — give each with a STAR outline",
      "  (Situation / Task / Action / Result) the candidate can fill in.",
      "## Technical questions — with sample answers at the depth this role implies.",
      "## Role-specific watch-outs — where candidates for THIS role typically",
      "  stumble, drawn from what the job description emphasizes.",
      "## Recruiter-call cheat sheet — concise talking points for a first screen.",
      "",
      "Be specific to the requirements in the job description. If it emphasizes a",
      "particular skill, weight the questions toward it.",
    ].join("\n"),
    user: [
      `Company: ${input.company}`,
      `Role: ${input.title}`,
      `\nJob description:\n${truncate(input.jd, LIMITS.jd)}`,
      "\nPrepare me for interviews for this role.",
    ].join("\n"),
  };
}

export function resumeTailorPrompt(input: ResumeTailorInput): PromptSpec {
  return {
    webSearch: false,
    maxTokens: 12_000,
    system: [
      "You tailor an existing resume to a specific job description.",
      "",
      "NEVER invent experience. You may only reframe, reorder, and reword what is",
      "already in the candidate's resume. Do not add employers, titles, dates,",
      "metrics, technologies, or accomplishments that do not appear in the source.",
      "If the role wants something the candidate does not have, that belongs in the",
      "gap analysis — not in the resume.",
      "",
      "Respond in Markdown with exactly these two sections, in this order:",
      "## Gap analysis",
      "  What this job asks for that the resume does not evidence, and what the",
      "  candidate genuinely has that maps to the requirements. Be honest and",
      "  specific — this section is for the candidate's eyes, not the employer's.",
      "## Tailored resume",
      "  The full rewritten resume, ready to send. Keep it truthful to the source.",
    ].join("\n"),
    user: [
      `Company: ${input.company}`,
      `Role: ${input.title}`,
      `\nJob description:\n${truncate(input.jd, LIMITS.jd)}`,
      `\nMy current resume:\n${truncate(input.baseResume, LIMITS.baseResume)}`,
      "\nTailor my resume for this role.",
    ].join("\n"),
  };
}
