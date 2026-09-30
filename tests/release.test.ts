import { describe, expect, test } from "bun:test";
import {
  releaseNeeded,
  verifyIdentity,
  resolveHash,
  publishRelease,
} from "../scripts/release";

const hash = "0x" + "a".repeat(32);
const current = {
  bend_hub_name: "bend-openai-sdk",
  bend_hub_version: "0.1.0.1",
  bend_hub_hash: hash,
};
describe("release identity", () => {
  test("only an intentional version increase releases; initial metadata is supported", () => {
    expect(releaseNeeded(current, {})).toBe(true);
    expect(releaseNeeded(current, current)).toBe(false);
    expect(
      releaseNeeded(current, { ...current, bend_hub_version: "0.1.0.0" }),
    ).toBe(true);
    expect(() =>
      releaseNeeded(current, { ...current, bend_hub_version: "0.1.0.2" }),
    ).toThrow("increase");
    expect(() =>
      releaseNeeded({ ...current, bend_hub_version: "0.1.01.1" }, {}),
    ).toThrow("metadata");
    expect(() =>
      releaseNeeded({ ...current, bend_hub_name: "another-package" }, {}),
    ).toThrow("metadata");
  });
  test("declared hash must match tested package", () => {
    expect(() => verifyIdentity(current, hash)).not.toThrow();
    expect(() => verifyIdentity(current, "0x" + "b".repeat(32))).toThrow(
      "hash",
    );
  });
  test("registry errors and malformed responses fail closed", async () => {
    expect(
      await resolveHash(
        current,
        async () => new Response("missing", { status: 404 }),
      ),
    ).toBeNull();
    await expect(
      resolveHash(current, async () => new Response("error", { status: 503 })),
    ).rejects.toThrow("503");
    await expect(
      resolveHash(current, async () => new Response("bad hash")),
    ).rejects.toThrow("invalid");
  });
  test("same identity reruns skip, different identity refuses without publishing", async () => {
    let published = 0;
    const publish = async () => {
      published++;
    };
    await publishRelease(current, async () => hash, publish);
    expect(published).toBe(0);
    await expect(
      publishRelease(current, async () => "0x" + "b".repeat(32), publish),
    ).rejects.toThrow("different hash");
    expect(published).toBe(0);
  });
  test("new release verifies public resolution; failed publication cannot pass", async () => {
    let published = false;
    await publishRelease(
      current,
      async () => (published ? hash : null),
      async () => {
        published = true;
      },
    );
    expect(published).toBe(true);
    await expect(
      publishRelease(
        current,
        async () => null,
        async () => {},
      ),
    ).rejects.toThrow("verification");
    await expect(
      publishRelease(
        current,
        async () => null,
        async () => {
          throw Error("publish failed");
        },
      ),
    ).rejects.toThrow("publish failed");
  });
});
