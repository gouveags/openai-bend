import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connect } from "node:net";
import OpenAI from "openai";
import { startBridge, MAX_REQUEST } from "../bridge/server";

const token = "test-only-bridge-token-0000000000000000";
const seen: Record<string, unknown>[] = [];
let bridge: Awaited<ReturnType<typeof startBridge>>;
let upstream: ReturnType<typeof Bun.serve>;
let sequence = 0;
function response(input: unknown) {
  return {
    id: "resp_test",
    object: "response",
    status: "completed",
    model: "mock",
    output: [
      {
        type: "message",
        id: "msg_test",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: `Hello 😀 ${String(input)}`,
            annotations: [],
          },
        ],
      },
    ],
    usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
    extra_future_field: { preserved: true },
  };
}
beforeAll(async () => {
  upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      expect(new URL(request.url).pathname).toBe("/v1/responses");
      const body = (await request.json()) as Record<string, unknown>;
      seen.push(body);
      if (body.input === "error")
        return Response.json(
          { error: { message: "bad request", type: "invalid_request_error" } },
          {
            status: 400,
            headers: { "x-request-id": "req_error", "retry-after": "1" },
          },
        );
      if (body.input === "slow") {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return Response.json(response(body.input));
      }
      if (body.stream) {
        const events = [
          {
            type: "response.created",
            response: { id: "resp_test", status: "in_progress" },
          },
          { type: "response.output_text.delta", delta: "Hello 😀" },
          { type: "future.event", new_field: true },
          ...(body.input === "truncated"
            ? []
            : [{ type: "response.completed", response: response(body.input) }]),
        ];
        const sse = events
          .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
          .join("");
        const bytes = new TextEncoder().encode(sse);
        const stream = new ReadableStream({
          async start(controller) {
            for (let i = 0; i < bytes.length; i += 7)
              controller.enqueue(bytes.slice(i, i + 7));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "x-request-id": "req_stream",
          },
        });
      }
      return Response.json(response(body.input), {
        headers: { "x-request-id": "req_test" },
      });
    },
  });
  bridge = await startBridge({
    token,
    client: new OpenAI({
      apiKey: "test-not-a-real-key",
      baseURL: `http://127.0.0.1:${upstream.port}/v1`,
      maxRetries: 0,
    }),
  });
});
afterAll(async () => {
  await bridge.close();
  await upstream.stop(true);
});

function request(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    token,
    id: `test_${++sequence}`,
    operation: "responses.create",
    stream: false,
    params: { model: "mock", input: "hello" },
    ...overrides,
  };
}
function wire(
  body: unknown,
  port = bridge.port,
  fragment = false,
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let out = "";
    socket.setTimeout(3000, () => socket.destroy(new Error("test timeout")));
    socket.on("error", reject);
    socket.on("data", (chunk) => {
      out += chunk;
    });
    socket.on("close", () => {
      try {
        resolve(
          out.trim()
            ? out
                .trim()
                .split("\n")
                .map((s) => JSON.parse(s))
            : [],
        );
      } catch (e) {
        reject(e);
      }
    });
    socket.on("connect", () => {
      const line =
        typeof body === "string" ? body : JSON.stringify(body) + "\n";
      if (fragment) {
        socket.write(line.slice(0, 15));
        setTimeout(() => socket.write(line.slice(15)), 5);
      } else socket.write(line);
    });
  });
}

describe("companion with official SDK and real local HTTP upstream", () => {
  test("complete result, metadata, unknown fields and fragment handling", async () => {
    const frames = await wire(request(), bridge.port, true);
    expect(frames.map((f) => f.kind)).toEqual(["result", "end"]);
    expect(frames[0].request_id).toBe("req_test");
    expect(frames[0].data.extra_future_field).toEqual({ preserved: true });
  });
  test("streaming preserves Unicode, semantic events and unknown events", async () => {
    const frames = await wire(request({ stream: true }));
    expect(frames[0].request_id).toBe("req_stream");
    expect(
      frames.find((f) => f.data?.type === "response.output_text.delta").data
        .delta,
    ).toBe("Hello 😀");
    expect(frames.some((f) => f.data?.type === "future.event")).toBe(true);
    expect(frames.at(-1).kind).toBe("end");
  });
  test("truncated upstream is a failure", async () => {
    const frames = await wire(
      request({ stream: true, params: { model: "mock", input: "truncated" } }),
    );
    expect(frames.at(-1).code).toBe("truncated_stream");
    expect(frames.some((f) => f.kind === "end")).toBe(false);
  });
  test("preserve API status, request ID and retry-after", async () => {
    const frames = await wire(
      request({ params: { model: "mock", input: "error" } }),
    );
    expect(frames[0]).toMatchObject({
      kind: "error",
      code: "api_error",
      status: 400,
      request_id: "req_error",
      retry_after: "1",
    });
  });
  test("unauthorized and invalid operations never reach upstream", async () => {
    const count = seen.length;
    expect((await wire(request({ token: "wrong" })))[0].code).toBe(
      "unauthorized",
    );
    expect((await wire(request({ version: 999 })))[0].code).toBe("protocol");
    expect(
      (await wire(request({ operation: "https://attacker.invalid" })))[0].code,
    ).toBe("protocol");
    expect(
      (
        await wire(
          request({ params: { model: "mock", input: "x", background: true } }),
        )
      )[0].code,
    ).toBe("unsupported");
    expect(seen.length).toBe(count);
  });
  test("malformed and oversized requests do not call upstream", async () => {
    const count = seen.length;
    expect((await wire("{bad\n"))[0].code).toBe("protocol");
    expect(await wire("x".repeat(MAX_REQUEST + 1) + "\n")).toEqual([]);
    expect(seen.length).toBe(count);
  });
  test("cancellation uses separate authenticated connection", async () => {
    const pending = wire(
      request({ id: "cancel_me", params: { model: "mock", input: "slow" } }),
    );
    await Bun.sleep(25);
    const ack = await wire(request({ id: "cancel_me", operation: "cancel" }));
    expect(ack[0]).toMatchObject({ kind: "cancelled", found: true });
    expect((await pending).at(-1).code).toBe("cancelled");
  });
  test("deadline aborts an upstream request", async () => {
    const short = await startBridge({
      token,
      deadlineMs: 20,
      client: new OpenAI({
        apiKey: "test",
        baseURL: `http://127.0.0.1:${upstream.port}/v1`,
        maxRetries: 0,
      }),
    });
    try {
      expect(
        (
          await wire(
            request({ params: { model: "mock", input: "slow" } }),
            short.port,
          )
        ).at(-1).code,
      ).toBe("cancelled");
    } finally {
      await short.close();
    }
  });
  test("simultaneous requests keep their identities", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => {
        const body = request();
        return wire(body).then((frames) => ({ body, frames }));
      }),
    );
    for (const { body, frames } of results)
      expect(frames.every((f) => f.id === body.id)).toBe(true);
  });

  test("disconnect aborts the request and releases its ID", async () => {
    const socket = connect(bridge.port, "127.0.0.1");
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    socket.write(
      JSON.stringify(
        request({ id: "disconnect", params: { model: "mock", input: "slow" } }),
      ) + "\n",
    );
    await Bun.sleep(20);
    expect(bridge.activeCount()).toBe(1);
    socket.destroy();
    await Bun.sleep(20);
    expect(bridge.activeCount()).toBe(0);
  });

  test("duplicate IDs cannot replace an active request", async () => {
    const pending = wire(
      request({ id: "duplicate", params: { model: "mock", input: "slow" } }),
    );
    await Bun.sleep(20);
    expect((await wire(request({ id: "duplicate" })))[0].code).toBe(
      "duplicate_id",
    );
    await wire(request({ id: "duplicate", operation: "cancel" }));
    expect((await pending).at(-1).code).toBe("cancelled");
  });

  test("connection cap applies before authentication and rejected peers are closed", async () => {
    const limited = await startBridge({
      token,
      maxConnections: 1,
      client: new OpenAI({
        apiKey: "test",
        baseURL: `http://127.0.0.1:${upstream.port}/v1`,
        maxRetries: 0,
      }),
    });
    const held = connect({
      port: limited.port,
      host: "127.0.0.1",
      allowHalfOpen: true,
    });
    held.on("error", () => {});
    held.on("data", () => {});
    try {
      await new Promise<void>((resolve) => held.once("connect", resolve));
      expect(await wire(request(), limited.port)).toEqual([]);
      held.write(JSON.stringify(request({ token: "wrong" })) + "\n");
      await Bun.sleep(1200);
      expect((await wire(request(), limited.port))[0].kind).toBe("result");
    } finally {
      held.destroy();
      await limited.close();
    }
  });

  for (const name of ["hello", "structured", "tools", "cancel"]) {
    test(`documented ${name} Bend example runs`, async () => {
      const child = Bun.spawn(["bun", `build/${name}.js`], {
        env: {
          ...Bun.env,
          OPENAI_BEND_PORT: String(bridge.port),
          OPENAI_BEND_TOKEN: token,
          OPENAI_MODEL: "mock",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (name === "cancel") {
        expect(code).toBe(1);
        expect(err).toContain("cancelled");
      } else {
        expect(code).toBe(0);
        expect(err).toBe("");
        expect(out).toContain("finished");
      }
      if (name === "structured")
        expect(seen.at(-1)).toHaveProperty("text.format.type", "json_schema");
      if (name === "tools")
        expect(seen.at(-1)).toHaveProperty("tools.0.name", "weather");
    });
  }
  test("structured outputs, tools, image/file inputs, omitted and null are passed through", async () => {
    const params = {
      model: "mock",
      input: [
        {
          role: "user",
          content: [
            { type: "input_image", image_url: "https://example.com/test.png" },
            { type: "input_file", file_id: "file_test" },
          ],
        },
      ],
      instructions: null,
      text: {
        format: {
          type: "json_schema",
          name: "result",
          strict: true,
          schema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      },
      tools: [
        { type: "function", name: "lookup", parameters: { type: "object" } },
      ],
    };
    await wire(request({ params }));
    expect(seen.at(-1)).toEqual({
      ...params,
      stream: false,
      background: false,
    });
    expect(seen.at(-1)).not.toHaveProperty("temperature");
  });

  for (const [backend, command] of [
    ["JavaScript", ["bun", "build/request.js"]],
    ["clean-package JavaScript", ["bun", "build/package-request.js"]],
    ["native", ["build/request"]],
  ] as const) {
    for (const streaming of [false, true]) {
      test(`Bend ${backend} ${streaming ? "streaming" : "create"} end to end`, async () => {
        const process = Bun.spawn(
          [
            ...command,
            `bend_${++sequence}`,
            streaming ? "stream" : "once",
            JSON.stringify({ model: "mock", input: "hello" }),
          ],
          {
            env: {
              ...Bun.env,
              OPENAI_BEND_PORT: String(bridge.port),
              OPENAI_BEND_TOKEN: token,
            },
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        const [out, err, code] = await Promise.all([
          new Response(process.stdout).text(),
          new Response(process.stderr).text(),
          process.exited,
        ]);
        expect(err).toBe("");
        expect(code).toBe(0);
        expect(out).toContain("Hello 😀");
        expect(out).toContain("finished");
      }, 20_000);
    }
  }
});
