import { getAccessToken } from "./tokens.ts";

const API_BASE: string = import.meta.env["VITE_API_BASE"] ?? "http://localhost:8080/api";

export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Consumes a server-sent event stream with `fetch` rather than `EventSource`.
 *
 * `EventSource` cannot set request headers, so using it would mean putting the
 * access token in the query string — where it lands in browser history, proxy
 * logs, and Referer headers. Reading the stream by hand keeps the token in an
 * Authorization header, at the cost of parsing the (simple) wire format here.
 */
export async function* streamEvents(
  path: string,
  signal: AbortSignal,
): AsyncGenerator<SseMessage> {
  const token = getAccessToken();

  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      accept: "text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`stream failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;

      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line; anything before the last one is
      // complete and safe to parse.
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const message = parseEvent(raw);
        if (message) yield message;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    // Releases the socket if the consumer stops early.
    await reader.cancel().catch(() => undefined);
  }
}

function parseEvent(raw: string): SseMessage | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    // A line starting with ':' is a comment — our heartbeat uses one.
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }

  return dataLines.length > 0 ? { event, data: dataLines.join("\n") } : null;
}
