import OpenAI from "openai";
import { startBridge } from "./server";

const token = process.env.OPENAI_BEND_TOKEN;
const apiKey = process.env.OPENAI_API_KEY;
if (!token || !apiKey) {
  console.error(
    "Set OPENAI_API_KEY and OPENAI_BEND_TOKEN (at least 32 characters). See README.md.",
  );
  process.exit(1);
}
const port = Number(process.env.OPENAI_BEND_PORT ?? "42101");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid OPENAI_BEND_PORT");
const bridge = await startBridge({
  token,
  port,
  deadlineMs: Number(process.env.OPENAI_BEND_DEADLINE_MS ?? "120000"),
  client: new OpenAI({
    apiKey,
    baseURL: "https://api.openai.com/v1",
    maxRetries: 2,
  }),
});
console.log(
  `openai-bend 0.1.0 listening on 127.0.0.1:${bridge.port} (protocol 1)`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void bridge.close().then(() => process.exit(0));
  });
}
