import { createMockAnthropic } from "./server.ts";

const port = Number(process.env["MOCK_ANTHROPIC_PORT"] ?? 4010);
const mock = createMockAnthropic(port);

await mock.listen();
process.stdout.write(
  JSON.stringify({
    time: new Date().toISOString(),
    level: "info",
    service: "mock-anthropic",
    msg: "listening",
    port,
  }) + "\n",
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void mock.close().then(() => process.exit(0));
  });
}
