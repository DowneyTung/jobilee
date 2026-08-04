/**
 * A stand-in for the Anthropic Messages API.
 *
 * ai-service points at this with ANTHROPIC_BASE_URL, so the real SDK, the real
 * SSE parser, and our real pause_turn / refusal / retry handling all execute
 * against it. A stubbed client would skip exactly the code most likely to be
 * wrong.
 *
 * Control surface (not part of the real API):
 *   POST   /__control  { scenario }  choose the next response shape
 *   GET    /__requests               every /v1/messages body received
 *   DELETE /__requests               clear the recording
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export const SCENARIOS = [
  "success",
  /** First call returns pause_turn; the resume returns the real answer. */
  "pause_then_success",
  "refusal",
  /** One 429, then success — exercises retry/backoff. */
  "rate_limit_once",
  "auth_error",
  "server_error",
  /** Ends with stop_reason max_tokens and partial text. */
  "truncated",
  /** A well-formed stream carrying no text blocks at all. */
  "empty",
] as const;
export type Scenario = (typeof SCENARIOS)[number];

export interface RecordedRequest {
  model: string;
  system: string;
  userText: string;
  toolTypes: string[];
  maxTokens: number;
  thinking: unknown;
  hasSamplingParams: boolean;
}

const DEFAULT_TEXT = [
  "## What they do",
  "Middle-out compression for data centres.",
  "",
  "## Recent news",
  "Announced a Series C in March 2026.",
  "",
  "## Culture & values",
  "Engineering-led, small teams, ships weekly.",
  "",
  "## Smart questions to ask",
  "- How is the platform team structured after the Series C?",
].join("\n");

export interface MockState {
  scenario: Scenario;
  requests: RecordedRequest[];
  /** Counts calls within the current scenario, for multi-step behaviors. */
  callCount: number;
}

export function createMockAnthropic(port: number) {
  const state: MockState = { scenario: "success", requests: [], callCount: 0 };

  const server = createServer((req, res) => {
    void handle(req, res, state).catch((error: unknown) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { type: "api_error", message: String(error) } }));
    });
  });

  return {
    state,
    listen: () =>
      new Promise<void>((resolve) => {
        server.listen(port, "0.0.0.0", () => resolve());
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  state: MockState,
): Promise<void> {
  const url = req.url ?? "/";

  if (url === "/__control" && req.method === "POST") {
    const body = (await readJson(req)) as { scenario?: Scenario };
    if (!body.scenario || !SCENARIOS.includes(body.scenario)) {
      return json(res, 400, { error: `scenario must be one of: ${SCENARIOS.join(", ")}` });
    }
    state.scenario = body.scenario;
    state.callCount = 0;
    return json(res, 200, { scenario: state.scenario });
  }

  if (url === "/__requests" && req.method === "GET") {
    return json(res, 200, { requests: state.requests });
  }

  if (url === "/__requests" && req.method === "DELETE") {
    state.requests = [];
    state.callCount = 0;
    return json(res, 200, { cleared: true });
  }

  if (url === "/__health") {
    return json(res, 200, { status: "ok", scenario: state.scenario });
  }

  if (url.startsWith("/v1/messages") && req.method === "POST") {
    const body = (await readJson(req)) as Record<string, unknown>;
    state.requests.push(record(body));
    state.callCount += 1;
    return respondToMessages(res, state);
  }

  return json(res, 404, { error: { type: "not_found_error", message: `no route for ${url}` } });
}

/** Captures the parts of a request the tests assert on. */
function record(body: Record<string, unknown>): RecordedRequest {
  const messages = (body["messages"] ?? []) as Array<{ role: string; content: unknown }>;
  const firstUser = messages.find((m) => m.role === "user");
  const tools = (body["tools"] ?? []) as Array<{ type?: string }>;

  return {
    model: String(body["model"] ?? ""),
    system: typeof body["system"] === "string" ? body["system"] : JSON.stringify(body["system"]),
    userText: typeof firstUser?.content === "string" ? firstUser.content : JSON.stringify(firstUser?.content),
    toolTypes: tools.map((t) => String(t.type)),
    maxTokens: Number(body["max_tokens"] ?? 0),
    thinking: body["thinking"],
    hasSamplingParams:
      body["temperature"] !== undefined ||
      body["top_p"] !== undefined ||
      body["top_k"] !== undefined,
  };
}

function respondToMessages(res: ServerResponse, state: MockState): void {
  switch (state.scenario) {
    case "auth_error":
      return json(res, 401, {
        type: "error",
        error: { type: "authentication_error", message: "invalid x-api-key" },
      });

    case "server_error":
      return json(res, 500, {
        type: "error",
        error: { type: "api_error", message: "internal server error" },
      });

    case "rate_limit_once":
      if (state.callCount === 1) {
        res.setHeader("retry-after", "1");
        return json(res, 429, {
          type: "error",
          error: { type: "rate_limit_error", message: "rate limit exceeded" },
        });
      }
      return streamMessage(res, { text: DEFAULT_TEXT, stopReason: "end_turn" });

    case "pause_then_success":
      // The server-side tool loop pauses; the SDK's caller must resume.
      if (state.callCount === 1) {
        return streamMessage(res, { text: "Searching…", stopReason: "pause_turn" });
      }
      return streamMessage(res, { text: DEFAULT_TEXT, stopReason: "end_turn" });

    case "refusal":
      return streamMessage(res, {
        text: "",
        stopReason: "refusal",
        stopDetails: { type: "refusal", category: "cyber", explanation: "declined" },
      });

    case "truncated":
      return streamMessage(res, { text: "## What they do\nPartial…", stopReason: "max_tokens" });

    case "empty":
      return streamMessage(res, { text: "", stopReason: "end_turn" });

    case "success":
    default:
      return streamMessage(res, { text: DEFAULT_TEXT, stopReason: "end_turn" });
  }
}

interface StreamOptions {
  text: string;
  stopReason: string;
  stopDetails?: Record<string, unknown>;
}

/** Emits the Messages API SSE event sequence the SDK expects. */
function streamMessage(res: ServerResponse, options: StreamOptions): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send("message_start", {
    type: "message_start",
    message: {
      id: `msg_mock_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: "mock-model",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1234, output_tokens: 0 },
    },
  });

  if (options.text.length > 0) {
    send("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
    // Chunked, so the SDK's incremental parser is genuinely exercised.
    for (const chunk of chunkText(options.text, 64)) {
      send("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: chunk },
      });
    }
    send("content_block_stop", { type: "content_block_stop", index: 0 });
  }

  send("message_delta", {
    type: "message_delta",
    delta: {
      stop_reason: options.stopReason,
      stop_sequence: null,
      ...(options.stopDetails ? { stop_details: options.stopDetails } : {}),
    },
    usage: { output_tokens: Math.max(1, Math.ceil(options.text.length / 4)) },
  });
  send("message_stop", { type: "message_stop" });
  res.end();
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length > 0 ? JSON.parse(raw) : {};
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
