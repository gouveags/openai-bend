import { createServer, type Socket } from "node:net";
import { timingSafeEqual } from "node:crypto";
import OpenAI from "openai";

export const VERSION = 1;
export const MAX_FRAME = 4 * 1024 * 1024;
export const MAX_REQUEST = 1024 * 1024;

export function encodeFrame(frame: unknown): string {
  const encoded = JSON.stringify(frame).replace(
    /[\u007f-\uffff]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
  if (encoded.length > MAX_FRAME)
    throw new Error("Response exceeds frame limit");
  return encoded + "\n";
}

function authenticated(value: unknown, token: string): boolean {
  if (typeof value !== "string") return false;
  const a = Buffer.from(value),
    b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type Options = {
  token: string;
  client: OpenAI;
  port?: number;
  deadlineMs?: number;
  maxConnections?: number;
};

export async function startBridge(options: Options) {
  if (options.token.length < 32)
    throw new Error("Bridge token must have at least 32 characters");
  const deadlineMs = options.deadlineMs ?? 120_000;
  if (
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < 1 ||
    deadlineMs > 600_000
  )
    throw new Error("Deadline must be between 1 and 600000 milliseconds");
  const active = new Map<string, AbortController>();
  const sockets = new Set<Socket>();

  const server = createServer({ allowHalfOpen: false }, (socket) => {
    if (sockets.size >= (options.maxConnections ?? 32)) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    const controller = new AbortController();
    let buffer = Buffer.alloc(0);
    let started = false;
    let id = "";
    let timer: ReturnType<typeof setTimeout>;
    const send = async (frame: unknown) => {
      const line = encodeFrame(frame);
      await new Promise<void>((resolve, reject) => {
        if (socket.destroyed) {
          reject(new Error("Client disconnected"));
          return;
        }
        socket.write(line, (error) => (error ? reject(error) : resolve()));
      });
    };
    const fail = async (
      code: string,
      message: string,
      status = 0,
      requestId = "",
      retryAfter = "",
    ) => {
      await send({
        kind: "error",
        id,
        code,
        message,
        status,
        request_id: requestId,
        retry_after: retryAfter,
      });
    };
    timer = setTimeout(() => socket.destroy(), 10_000);
    socket.setTimeout(10_000, () => socket.destroy());
    const end = () => {
      socket.setTimeout(1000);
      socket.end();
    };
    socket.on("error", () => {});
    socket.on("close", () => {
      clearTimeout(timer);
      controller.abort();
      if (active.get(id) === controller) active.delete(id);
      sockets.delete(socket);
    });

    async function dispatch(raw: unknown) {
      if (
        record(raw) &&
        typeof raw.id === "string" &&
        /^[a-zA-Z0-9_-]{1,128}$/.test(raw.id)
      )
        id = raw.id;
      if (!record(raw) || !authenticated(raw.token, options.token)) {
        await fail("unauthorized", "Invalid bridge credentials");
        return;
      }
      if (raw.version !== VERSION) {
        await fail("protocol", "Unsupported protocol version");
        return;
      }
      if (
        typeof raw.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(raw.id)
      ) {
        await fail("protocol", "Invalid request id");
        return;
      }
      id = raw.id;
      if (raw.operation === "cancel") {
        const target = active.get(id);
        if (target) target.abort();
        await send({ kind: "cancelled", id, found: !!target });
        return;
      }
      if (
        raw.operation !== "responses.create" ||
        typeof raw.stream !== "boolean" ||
        !record(raw.params)
      ) {
        await fail(
          "protocol",
          "Expected responses.create, stream boolean, and params object",
        );
        return;
      }
      if (active.has(id)) {
        await fail("duplicate_id", "Request id is already active");
        return;
      }
      if (
        typeof raw.params.model !== "string" ||
        !raw.params.model.length ||
        !("input" in raw.params)
      ) {
        await fail("protocol", "A model and input are required");
        return;
      }
      if (raw.params.background === true) {
        await fail(
          "unsupported",
          "Background responses are not supported in v0.1",
        );
        return;
      }
      // Request bodies cannot select URLs, headers, SDK methods or credentials.
      const params = { ...raw.params, stream: raw.stream, background: false };
      active.set(id, controller);
      clearTimeout(timer);
      timer = setTimeout(() => {
        controller.abort(new Error("Request deadline exceeded"));
      }, deadlineMs);
      // A stalled consumer must not retain a connection after the upstream abort.
      socket.setTimeout(deadlineMs + 1000, () => socket.destroy());
      try {
        if (raw.stream) {
          const { data: stream, request_id } = await options.client.responses
            .create(params as OpenAI.Responses.ResponseCreateParamsStreaming, {
              signal: controller.signal,
            })
            .withResponse();
          await send({ kind: "metadata", id, request_id });
          let terminal = false;
          for await (const event of stream) {
            await send({ kind: "event", id, data: event });
            if (
              [
                "response.completed",
                "response.failed",
                "response.incomplete",
                "error",
              ].includes(event.type)
            )
              terminal = true;
          }
          if (controller.signal.aborted) throw new Error("Request aborted");
          if (!terminal) {
            await fail(
              "truncated_stream",
              "Upstream ended without a terminal event",
              0,
              request_id ?? "",
            );
            return;
          }
        } else {
          const { data, request_id } = await options.client.responses
            .create(
              params as OpenAI.Responses.ResponseCreateParamsNonStreaming,
              { signal: controller.signal },
            )
            .withResponse();
          await send({ kind: "result", id, request_id, data });
        }
        await send({ kind: "end", id });
      } catch (error) {
        if (socket.destroyed) return;
        if (controller.signal.aborted) {
          await fail("cancelled", "Request cancelled or deadline exceeded");
        } else if (error instanceof OpenAI.APIError) {
          // Provider errors may echo submitted content; expose them only to the authenticated caller.
          const message = error.message
            .split(options.client.apiKey ?? "__no_key__")
            .join("[redacted]")
            .split(options.token)
            .join("[redacted]");
          await fail(
            "api_error",
            message,
            error.status ?? 0,
            error.requestID ?? "",
            error.headers?.get("retry-after") ?? "",
          );
        } else {
          await fail(
            "transport_error",
            "Upstream connection failed or response exceeded the frame limit",
          );
        }
      } finally {
        clearTimeout(timer);
        if (active.get(id) === controller) active.delete(id);
      }
    }

    socket.on("data", (data) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (started) {
        socket.destroy();
        return;
      }
      if (buffer.length + chunk.length > MAX_REQUEST) {
        socket.destroy();
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      const newline = buffer.indexOf(10);
      if (newline < 0) return;
      started = true;
      clearTimeout(timer);
      if (newline !== buffer.length - 1) {
        socket.destroy();
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
      } catch {
        void fail("protocol", "Invalid JSON")
          .finally(end)
          .catch(() => socket.destroy());
        return;
      }
      buffer = Buffer.alloc(0);
      void dispatch(raw)
        .then(end)
        .catch(() => socket.destroy());
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing bridge address");
  return {
    port: address.port,
    activeCount: () => active.size,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
