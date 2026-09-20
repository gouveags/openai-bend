import { expect, test } from "bun:test";

test("typed response extracts ordered text and multiple function calls, preserving raw content", () => {
  const raw = {
    id: "resp_typed",
    status: "completed",
    output: [
      {
        type: "message",
        content: [
          { type: "output_text", text: "one" },
          { type: "refusal", refusal: "not text" },
          { type: "output_text", text: "two" },
        ],
      },
      {
        type: "function_call",
        id: "a",
        call_id: "call_a",
        name: "lookup",
        arguments: "{}",
      },
      {
        type: "function_call",
        id: "b",
        call_id: "call_b",
        name: "lookup",
        arguments: "{}",
      },
    ],
    usage: null,
    future: true,
  };
  const result = Bun.spawnSync([
    "bun",
    "build/helpers.js",
    JSON.stringify(raw),
  ]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe(
    "resp_typed|completed|onetwo|2|" + JSON.stringify(raw),
  );
});

test("refusals and incomplete status are not silently converted into successful text", () => {
  const raw = {
    id: "resp_refusal",
    status: "incomplete",
    output: [
      {
        type: "message",
        content: [{ type: "refusal", refusal: "Cannot comply" }],
      },
    ],
  };
  const result = Bun.spawnSync([
    "bun",
    "build/helpers.js",
    JSON.stringify(raw),
  ]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toStartWith("resp_refusal|incomplete||0|");
  expect(result.stdout.toString()).toContain("Cannot comply");
});
