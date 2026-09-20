# openai-bend

**An unofficial OpenAI SDK for Bend, with typed requests, streaming, and tool calling.**

Write your application in Bend. Use OpenAI's official TypeScript SDK for the network connection. A small, authenticated companion process connects the two over localhost.

[Examples](./examples) · [Source](https://github.com/gouveags/openai-bend) · [Report an issue](https://github.com/gouveags/openai-bend/issues)

> Experimental v0.1.0. This is a community project, not an official OpenAI or Bend project. It implements the foreground Responses API. It is not a feature-complete replacement for the Python or TypeScript SDKs.

<!-- hub:start -->

## Install from Bend Hub

[Package source](https://hub.bend-lang.com/0xda004b6e25aca0ce4a1c90a4af87bee0/openai.bend) · [Verified manifest](https://hub.bend-lang.com/0xda004b6e25aca0ce4a1c90a4af87bee0/manifest) · [Packaged README](https://hub.bend-lang.com/0xda004b6e25aca0ce4a1c90a4af87bee0/docs.bend)

Use these exact imports in your project:

```bend
import 0xda004b6e25aca0ce4a1c90a4af87bee0/openai.bend as OpenAI
import 0xda004b6e25aca0ce4a1c90a4af87bee0/json.bend as Json
```

Bend downloads and verifies the content-addressed package when you build your program. There is no separate `npm install`-style command for the Bend modules. Install and start the companion below, then compile your app with `bend app.bend -o app.js` and run it with `bun app.js`.

This immutable hash identifies v0.1.0. GitHub hosts the full project, companion, examples, tests and releases. The Hub package includes a README snapshot and links back here.
<!-- hub:end -->

## What you get

| Capability                                          | v0.1.0                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| Create responses                                    | Typed request builder plus arbitrary JSON options                  |
| Streaming                                           | Every semantic event, including unknown future events              |
| Response helpers                                    | Text, function calls, usage and complete raw JSON                  |
| Structured outputs                                  | JSON Schema request helper; application-controlled decoding        |
| Function calling                                    | Tool definitions, typed call extraction and function-output helper |
| Images and files                                    | References in request JSON; no upload helper                       |
| Cancellation                                        | Close a stream, or cancel by ID over a separate connection         |
| Error metadata                                      | API status, request ID and Retry-After                             |
| Native / JavaScript                                 | Same Bend API and companion protocol                               |
| Uploads, pagination, background responses, Realtime | Not implemented                                                    |

Function execution is deliberately explicit: the library never executes a command or function just because the model named it. Refusals, failed/incomplete responses, annotations and provider-specific details remain available in the raw response or event.

## Requirements

- Linux or macOS. The tested platform is Linux x86_64; macOS is not yet validated.
- [Bend 2](https://github.com/bendlang/bend), [Bun](https://bun.sh/), and Git.
- Clang 14+ and Make for native builds.
- An OpenAI API key and access to your selected model for real inference.

The companion is a separate local process. **Installing the Bend Hub package does not install Bun, the companion, or its dependencies.**

## Install the companion

```sh
git clone https://github.com/gouveags/openai-bend.git
cd openai-bend
git checkout v0.1.0
bun install --frozen-lockfile
```

Load your API key into `OPENAI_API_KEY` using your secret manager or shell's private input facility. Do not put it in source code, commit an environment file, or paste it into a command that will be saved in shell history.

Generate a separate local bridge token:

```sh
export OPENAI_BEND_TOKEN="$(openssl rand -hex 32)"
export OPENAI_BEND_PORT=42101
export OPENAI_MODEL='your-available-model-id'
bun run bridge
```

Expected startup message:

```text
openai-bend 0.1.0 listening on 127.0.0.1:42101 (protocol 1)
```

Your Bend process needs `OPENAI_BEND_TOKEN`, `OPENAI_BEND_PORT` and your model selection. **It does not need the OpenAI API key.** When using separate terminals, share the same bridge token through your local secret-management mechanism. The bridge does not print credentials.

## Run an example

From another terminal with the bridge token available:

```sh
make build/request.js
bun build/request.js example-1 once \
  "{\"model\":\"$OPENAI_MODEL\",\"input\":\"Say hello.\"}"

# Stream every event:
bun build/request.js example-2 stream \
  "{\"model\":\"$OPENAI_MODEL\",\"input\":\"Explain interaction nets briefly.\"}"
```

The command prints the result or each semantic event, then `finished`. Provider, protocol and transport failures exit nonzero. `finished` means the transport ended correctly: inspect the response status or terminal event to distinguish completed, failed and incomplete model output.

For native execution:

```sh
make build/request
./build/request example-3 once \
  "{\"model\":\"$OPENAI_MODEL\",\"input\":\"Say hello.\"}"
```

The Makefile emits C using Bend and compiles with Clang `-O1` by default to keep development builds manageable. Override `CFLAGS` for an optimized build after validating it on your machine. This project makes no performance claim.

## Use the Bend library

Within this checkout, a minimal typed request looks like this:

```bend
import Base
import ./openai.bend as OpenAI

def start(token: String, model: String) ->
  IO(Result<&1, &1, OpenAI.Error, OpenAI.Stream>):
  OpenAI.create(
    OpenAI.Client{42101, token},
    "my-unique-request-id",
    OpenAI.text_request(model, "Say hello."))
```

`create` and `stream` return an owned stream handle. Call `OpenAI.next` until it returns:

- `Event{stream, kind, data, request_id}` — process the event and use the returned stream for the next read.
- `Finished{}` — the connection has closed cleanly.
- `Failed{error}` — the connection has closed with a transport, API or protocol error.

For nonstreaming calls, the event kind is `result`. Streaming calls first expose `metadata`, followed by provider event names such as `response.output_text.delta`. All events include their original JSON payload. `OpenAI.response(data)` extracts a typed response from a `result` payload; for a terminal streaming event, pass its nested `response` object.

Call `OpenAI.close(stream)` if you stop consuming early. To cancel a blocked request from another Bend computation, use `OpenAI.cancel(client, request_id)`. Cancellation requests an upstream abort; it cannot guarantee that remote processing or billing has not already happened.

See [the complete reader](./examples/request.bend), [hello](./examples/hello.bend), [structured outputs](./examples/structured.bend), [tools](./examples/tools.bend), and [cancellation](./examples/cancel.bend). All examples read `OPENAI_BEND_PORT` and `OPENAI_BEND_TOKEN`.

## Structured outputs and tools

`OpenAI.Request{model, input, options}` accepts a JSON input and additional fields. Use `Json.Text` for a simple prompt, or a `Json.Array` for messages, image/file references and tool results.

```bend
# Add these fields to Request.options:
Json.Field{"text", OpenAI.json_schema("person", schema)}
Json.Field{"tools", Json.Array{[
  OpenAI.function_tool("weather", "Look up weather", schema)
]}}
```

The schema must meet [OpenAI's supported JSON Schema rules](https://developers.openai.com/api/docs/guides/structured-outputs). Structured output is not automatically converted into an arbitrary Bend datatype: inspect the response status/refusal, parse its text with `Json.read`, then validate your application's fields.

For tools, inspect `Response.calls`. Each `FunctionCall` contains `id`, `call_id`, `name`, JSON-encoded `arguments`, and the complete raw item. Validate the name and arguments against an application-owned allowlist before executing anything. Return a result with `OpenAI.function_output(call_id, output)`.

For a stored-response continuation, submit that item in the next input with `previous_response_id` set to the response ID. Repeat instructions and tool definitions as needed; instructions are not automatically inherited. For stateless/manual replay, follow the [official continuation guidance](https://developers.openai.com/api/docs/guides/function-calling), including reasoning items. There is no automatic tool loop in this release.

## JSON and forward compatibility

`json.bend` supplies `Null`, `Boolean`, `Number`, `Text`, `Array` and `Object`, with `Field` entries for objects. `Json.get` returns `None` for an absent property and `Some{Null{}}` for explicit null. Omit an option by leaving it out of the field list.

Numbers are stored as decimal strings and do not pass through Bend's `F32`. The companion uses JavaScript JSON and the official SDK, so its normal IEEE-754 numeric limitations still apply. Do not send integers beyond JavaScript's safe range expecting lossless end-to-end arithmetic.

Use valid JSON number strings in `Json.Number`. Unknown response fields and event types are preserved. `OpenAI.open_raw` accepts an arbitrary JSON request object for newly added fields, but supports only the allowlisted Responses create operation. Request options cannot change the companion's URL, credentials or SDK method.

## Architecture and security

```text
Bend application ── authenticated localhost TCP ── companion
                                                     │
                                          official openai SDK
                                                     │ HTTPS
                                                 OpenAI API
```

- The companion binds only `127.0.0.1`. It is not a public server and must not be exposed through a proxy or tunnel.
- A token of at least 32 characters is required. Use a randomly generated token, not a memorable password. API credentials remain in the companion process.
- One request per connection; cancellation uses a separate connection and request ID. Use unique IDs for simultaneous requests.
- JSON decoding is limited to 64 nesting levels and 65536 tokens. Requests are capped at 1 MiB; output frames at 4 MiB; concurrent connections at 32. Partial requests expire after 10 seconds.
- The upstream deadline defaults to 120 seconds and can be configured with `OPENAI_BEND_DEADLINE_MS`, up to 600000. Socket inactivity is also bounded.
- The official SDK owns retries (two retries configured in the CLI). The bridge does not replay requests after disconnect or restart. Do not automatically retry a partly received inference result without considering duplicate execution/cost.
- Frames are newline-delimited JSON, with non-ASCII characters escaped. The Bend reader handles fragmented/coalesced frames and Unicode surrogate pairs.
- The CLI fixes the upstream URL to `https://api.openai.com/v1`. Alternate upstream clients exist only as programmatic configuration for tests or an operator-controlled integration.
- No telemetry or prompt logging is implemented by this project. Provider error messages are returned to the authenticated caller and may contain submitted content. Example programs intentionally print responses.

The bridge token is sent over local TCP without TLS. This design assumes a trusted local machine and companion. It does not protect against a compromised local account, privileged process, malicious replacement bridge, or someone who can read your process environment. Bend's termination/type checks do not prove the socket runtime, provider behavior or the entire SDK secure. The source marks the few externally driven or structurally unrecognized recursive functions `@unsafe` explicitly.

## Development and validation

```sh
bun install --frozen-lockfile
make test
bun audit
```

Tests use the actual OpenAI TypeScript SDK against a local HTTP mock, plus real TCP connections and compiled Bend clients. They require no real API key and make no inference requests to OpenAI. A successful local mock run proves protocol and integration behavior, not model behavior or account access.

The dependency lockfile is committed. Formatting and TypeScript checks are part of `make test`. See `compatibility.json` for the pinned compiler, companion protocol and SDK versions.

## Troubleshooting

| Symptom                               | Check                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| Connection refused                    | Start the companion and check the port.                                         |
| Unauthorized / request-ID mismatch    | Use the same bridge token in both processes.                                    |
| API 401/403                           | Check the companion's API key and project/model access.                         |
| API 429                               | Inspect error metadata; avoid adding another unbounded retry loop.              |
| Truncated stream                      | Treat the partial output as incomplete; do not silently call it success.        |
| Native build consumes too much memory | Use the tested compiler and default Makefile flags; report a reproducible case. |

## License

MIT. The OpenAI TypeScript SDK is a separately licensed dependency. Bend is a separate project. Contributions and reproducible bug reports are welcome at [GitHub](https://github.com/gouveags/openai-bend/issues).
