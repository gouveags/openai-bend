import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const names = [
  "openai.bend",
  "json.bend",
  "transport.bend",
  "docs.bend",
].sort();
const files = new Map(
  await Promise.all(
    names.map(async (name) => [name, await Bun.file(name).text()] as const),
  ),
);
const manifest = names
  .map((name) => `${sha(files.get(name)!)} ${name}\n`)
  .join("");
const hash = "0x" + sha(manifest).slice(0, 32);
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === `/${hash}/manifest`) return new Response(manifest);
    const name = path.slice(hash.length + 2);
    if (path.startsWith(`/${hash}/`) && files.has(name))
      return new Response(files.get(name));
    return new Response("missing", { status: 404 });
  },
});
const directory = await mkdtemp(join(tmpdir(), "openai-bend-package-"));
try {
  await mkdir("build", { recursive: true });
  await Bun.write(
    join(directory, "consumer.bend"),
    `import Base\nimport ${hash}/openai.bend as OpenAI\nimport ${hash}/json.bend as Json\n\ndef main() -> IO(Unit):\n  IO.print(OpenAI.repository() ++ " " ++ Json.stringify(OpenAI.params(OpenAI.text_request("mock", "hello"))))\n`,
  );
  const output = resolve("build/package-consumer.js");
  const child = Bun.spawn(
    [
      process.env.BEND ?? `${process.env.HOME}/.bend/bin/bend`,
      join(directory, "consumer.bend"),
      "-o",
      output,
    ],
    {
      env: {
        ...process.env,
        BEND_LIB: join(directory, "lib"),
        BEND_HUB: `http://127.0.0.1:${server.port}`,
        BEND_NO_TELEMETRY: "1",
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if ((await child.exited) !== 0)
    throw new Error("Clean package import failed");
  const requestSource = (await Bun.file("examples/request.bend").text())
    .replace("../openai.bend", `${hash}/openai.bend`)
    .replace("../json.bend", `${hash}/json.bend`);
  const requestFile = join(directory, "request.bend");
  await Bun.write(requestFile, requestSource);
  const requestBuild = Bun.spawn(
    [
      process.env.BEND ?? `${process.env.HOME}/.bend/bin/bend`,
      requestFile,
      "-o",
      resolve("build/package-request.js"),
    ],
    {
      env: {
        ...process.env,
        BEND_LIB: join(directory, "lib"),
        BEND_HUB: `http://127.0.0.1:${server.port}`,
        BEND_NO_TELEMETRY: "1",
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if ((await requestBuild.exited) !== 0)
    throw new Error("Package request client build failed");
  const run = Bun.spawn(["bun", output], { stdout: "pipe", stderr: "inherit" });
  const text = await new Response(run.stdout).text();
  if (
    (await run.exited) !== 0 ||
    !text.includes(
      'https://github.com/gouveags/openai-bend {"model":"mock","input":"hello"}',
    )
  )
    throw new Error("Clean package consumer failed");
  await Bun.write(
    "build/package.json",
    JSON.stringify(
      { hash, manifest, files: Object.fromEntries(files) },
      null,
      2,
    ) + "\n",
  );
  console.log(`Clean package import and execution passed: ${hash}`);
} finally {
  await server.stop(true);
  await rm(directory, { recursive: true, force: true });
}
