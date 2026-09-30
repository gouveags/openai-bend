import OpenAI from "openai";
import { randomBytes } from "node:crypto";
import { startBridge } from "../bridge/server";

if (process.env.SDK_LIVE_TEST !== "1")
  throw new Error(
    "Set SDK_LIVE_TEST=1 to authorize two billed inference requests.",
  );
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENAI_API_KEY securely before running.");
const model = process.env.OPENAI_MODEL ?? "gpt-4.1-nano";
const token = randomBytes(32).toString("hex");
const bridge = await startBridge({
  token,
  port: 0,
  deadlineMs: 30000,
  client: new OpenAI({
    apiKey,
    baseURL: "https://api.openai.com/v1",
    maxRetries: 0,
    logLevel: "off",
  }),
});
try {
  for (const [mode, command] of [
    ["once", ["bun", "build/request.js"]],
    ["stream", ["./build/request"]],
  ] as const) {
    const child = Bun.spawn(
      [
        ...command,
        "live-" + mode,
        mode,
        JSON.stringify({
          model,
          input: "Reply with exactly SDK_OK.",
          max_output_tokens: 64,
          store: false,
        }),
      ],
      {
        env: {
          PATH: process.env.PATH ?? "",
          OPENAI_BEND_TOKEN: token,
          OPENAI_BEND_PORT: String(bridge.port),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const timer = setTimeout(() => child.kill("SIGKILL"), 40000);
    let stdout: string;
    let code: number;
    try {
      const result = await Promise.all([
        new Response(child.stdout).text(),
        child.exited,
        new Response(child.stderr).text(),
      ]);
      [stdout, code] = result;
    } finally {
      clearTimeout(timer);
    }
    if (code !== 0)
      throw new Error(
        `Live ${mode} client failed (exit ${code}); provider payload omitted.`,
      );
    const lines = stdout.trim().split("\n");
    if (lines.at(-1) !== "finished")
      throw new Error("Transport did not finish");
    const events = lines.slice(0, -1).map((line) => {
      const at = line.indexOf(" ");
      return { kind: line.slice(0, at), data: JSON.parse(line.slice(at + 1)) };
    });
    const response =
      mode === "once"
        ? events.find((e) => e.kind === "result")?.data
        : events.find((e) => e.kind === "response.completed")?.data.response;
    if (!response || response.status !== "completed")
      throw new Error("Missing completed response");
    const text = response.output
      .flatMap((item: any) => item.content ?? [])
      .filter((item: any) => item.type === "output_text")
      .map((item: any) => item.text)
      .join("");
    if (text.trim() !== "SDK_OK")
      throw new Error("Unexpected live reply; payload omitted.");
    console.log(
      JSON.stringify({
        provider: "openai",
        model,
        mode,
        client: mode === "once" ? "JavaScript" : "native",
        reply: text.trim(),
        passed: true,
      }),
    );
  }
} finally {
  await bridge.close();
}
