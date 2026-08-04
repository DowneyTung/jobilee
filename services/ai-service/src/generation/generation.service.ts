import { Inject, Injectable } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "@jobilee/logger";
import { AppError, CONFIG, LOGGER } from "@jobilee/service-kit";
import type { CreateTaskRequest } from "@jobilee/shared-types";
import type { Config } from "../config.ts";
import {
  interviewPrepPrompt,
  researchPrompt,
  resumeTailorPrompt,
  type PromptSpec,
} from "./prompts.ts";

export interface GenerationResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * The server-side tool loop pauses after ~10 iterations with
 * `stop_reason: "pause_turn"`. Resuming means re-sending the conversation;
 * without this the answer is silently truncated mid-research.
 */
const MAX_CONTINUATIONS = 5;

@Injectable()
export class GenerationService {
  private readonly client: Anthropic;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly log: Logger,
  ) {
    this.client = new Anthropic({
      apiKey: config.ANTHROPIC_API_KEY,
      // The SDK retries 429/5xx with backoff on its own. Kept low because
      // BullMQ retries the whole job on top of this — see queue.service.ts.
      maxRetries: 2,
      timeout: 10 * 60 * 1000, // ms in the TS SDK
    });
  }

  async generate(task: CreateTaskRequest): Promise<GenerationResult> {
    const spec = this.specFor(task);

    // Research needs current facts, so it gets the web search tool. The
    // _20260209 variant filters results before they reach the context window;
    // declaring `code_execution` alongside it would create a second execution
    // environment and confuse the model.
    const tools = spec.webSearch
      ? [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 8 }]
      : undefined;

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: spec.user }];
    let inputTokens = 0;
    let outputTokens = 0;

    for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
      // Streamed: these run 20–40s and can emit thousands of tokens, which
      // would risk an HTTP timeout on a non-streaming request.
      const stream = this.client.messages.stream({
        model: this.config.AI_MODEL_GENERATION,
        max_tokens: spec.maxTokens,
        system: spec.system,
        thinking: { type: "adaptive" },
        messages,
        ...(tools ? { tools } : {}),
      });

      const message = await stream.finalMessage();
      inputTokens += message.usage.input_tokens;
      outputTokens += message.usage.output_tokens;

      // Safety classifiers can decline; that is a successful HTTP 200 with an
      // empty or partial body, not an exception.
      if (message.stop_reason === "refusal") {
        this.log.warn("generation refused", {
          type: task.type,
          category: message.stop_details?.category,
        });
        throw new AppError(
          "BAD_REQUEST",
          "The model declined this request. Try rephrasing the job description.",
        );
      }

      if (message.stop_reason === "pause_turn") {
        // The server paused its own tool loop; echo the turn back to resume.
        messages.push({ role: "assistant", content: message.content });
        this.log.debug("resuming paused turn", { type: task.type, attempt });
        continue;
      }

      const text = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();

      if (text.length === 0) {
        throw new AppError("UPSTREAM_ERROR", "The model returned an empty response.");
      }

      if (message.stop_reason === "max_tokens") {
        this.log.warn("generation hit max_tokens", { type: task.type, outputTokens });
      }

      return { text, inputTokens, outputTokens };
    }

    throw new AppError(
      "UPSTREAM_ERROR",
      "Research took too many steps to complete. Please try again.",
    );
  }

  private specFor(task: CreateTaskRequest): PromptSpec {
    switch (task.type) {
      case "RESEARCH":
        return researchPrompt(task.input);
      case "INTERVIEW_PREP":
        return interviewPrepPrompt(task.input);
      case "RESUME_TAILOR":
        return resumeTailorPrompt(task.input);
    }
  }
}

/**
 * Turns a provider error into something safe to show a user, and says whether
 * retrying could plausibly help. Raw SDK errors can carry request details we
 * don't want in a UI.
 */
export function describeFailure(error: unknown): { message: string; retryable: boolean } {
  if (error instanceof AppError) {
    return { message: error.message, retryable: false };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { message: "The AI service is busy right now. Please try again shortly.", retryable: true };
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return { message: "The AI service is not configured correctly.", retryable: false };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { message: "Could not reach the AI service. Please try again.", retryable: true };
  }
  if (error instanceof Anthropic.APIError) {
    return {
      message: "The AI service returned an error. Please try again.",
      retryable: error.status === undefined || error.status >= 500,
    };
  }
  return { message: "Generation failed unexpectedly. Please try again.", retryable: true };
}
