import { appendFile, chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

type Metadata = {
  bend_hub_name?: string;
  bend_hub_version?: string;
  bend_hub_hash?: string;
};
const hub = "https://hub.bend-lang.com";
const hashPattern = /^0x[0-9a-f]{32}$/;

export function releaseNeeded(current: Metadata, previous: Metadata): boolean {
  if (
    current.bend_hub_name !== "bend-openai-sdk" ||
    !/^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*)){3}$/.test(
      current.bend_hub_version ?? "",
    ) ||
    !hashPattern.test(current.bend_hub_hash ?? "")
  )
    throw Error("Invalid release metadata");
  if (current.bend_hub_version === previous.bend_hub_version) return false;
  if (previous.bend_hub_version) {
    const before = previous.bend_hub_version.split(".").map(BigInt);
    const after = current.bend_hub_version!.split(".").map(BigInt);
    const changed = after.findIndex((part, i) => part !== before[i]);
    if (changed < 0 || after[changed]! <= before[changed]!)
      throw Error("Release version must increase");
  }
  return true;
}

export function verifyIdentity(metadata: Metadata, hash: string): void {
  if (hash !== metadata.bend_hub_hash)
    throw Error("Tested package hash differs from release metadata");
}

export async function resolveHash(
  metadata: Metadata,
  request: (url: string) => Promise<Response> = (url) =>
    fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "error" }),
): Promise<string | null> {
  const response = await request(
    `${hub}/name/${metadata.bend_hub_name}@${metadata.bend_hub_version}`,
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw Error(`Hub resolution failed: HTTP ${response.status}`);
  const hash = (await response.text()).trim();
  if (!hashPattern.test(hash))
    throw Error("Hub returned invalid resolved hash");
  return hash;
}

export async function publishRelease(
  metadata: Metadata,
  resolve: () => Promise<string | null>,
  publish: () => Promise<void>,
): Promise<void> {
  const existing = await resolve();
  if (existing !== null) {
    if (existing !== metadata.bend_hub_hash)
      throw Error("Version already exists with a different hash");
    console.log("Release already published with the expected hash");
    return;
  }
  await publish();
  if ((await resolve()) !== metadata.bend_hub_hash)
    throw Error("Public release verification failed");
  console.log(
    `Verified ${metadata.bend_hub_name}@${metadata.bend_hub_version}: ${metadata.bend_hub_hash}`,
  );
}

if (import.meta.main) {
  const metadata: Metadata = await Bun.file("compatibility.json").json();
  const previous = Bun.spawnSync(["git", "show", "HEAD^:compatibility.json"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (previous.exitCode !== 0)
    throw Error("Cannot read previous main release metadata");
  const needed = releaseNeeded(
    metadata,
    JSON.parse(previous.stdout.toString()),
  );
  if (process.argv.includes("--plan")) {
    if (process.env.GITHUB_OUTPUT)
      await appendFile(process.env.GITHUB_OUTPUT, `needed=${needed}\n`);
    console.log(
      needed
        ? "Intentional Hub version increase detected"
        : "Hub version unchanged; skipping release",
    );
  } else if (needed) {
    const pkg = await Bun.file("build/package.json").json();
    verifyIdentity(metadata, pkg.hash);
    await publishRelease(
      metadata,
      () => resolveHash(metadata),
      async () => {
        const token = process.env.BEND_HUB_TOKEN;
        delete process.env.BEND_HUB_TOKEN;
        if (!token?.trim())
          throw Error("BEND_HUB_TOKEN repository secret is missing");
        const directory = join(homedir(), ".bend");
        const credentials = join(directory, "bender.json");
        await mkdir(directory, { recursive: true });
        // Exclusive creation avoids replacing a developer's existing login.
        await writeFile(credentials, JSON.stringify({ key: token }), {
          mode: 0o600,
          flag: "wx",
        });
        try {
          await chmod(credentials, 0o600);
          const child = Bun.spawn(
            [
              join(directory, "bin/bend"),
              "openai.bend",
              "--publish",
              `${metadata.bend_hub_name}@${metadata.bend_hub_version}`,
            ],
            {
              env: { ...process.env, BEND_HUB: hub, BEND_NO_TELEMETRY: "1" },
              stdin: "ignore",
              stdout: "ignore",
              stderr: "ignore",
              timeout: 300_000,
            },
          );
          // CLI output is suppressed so a remote failure cannot echo credentials.
          if ((await child.exited) !== 0)
            throw Error(
              "Bend publish failed; check Hub credentials and version ownership",
            );
        } finally {
          await rm(credentials, { force: true });
        }
      },
    );
  }
}
