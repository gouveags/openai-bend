import { describe, expect, test } from "bun:test";

function run(input: string) {
  return Bun.spawnSync(["bun", "build/json.js", input]);
}

describe("Bend JSON codec", () => {
  test("64 KiB text does not overflow the JavaScript stack", () => {
    const value = "a\n😀".repeat(8192);
    const result = run(JSON.stringify(value));
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toBe(value);
  });
  test("excessive nesting is rejected", () => {
    expect(run("[".repeat(65) + "0" + "]".repeat(65)).exitCode).not.toBe(0);
  });
  for (const value of [
    null,
    true,
    false,
    0,
    -2,
    1.25,
    1e30,
    "",
    '😀 café \n\t\b\f\r"\\',
    [],
    {},
    [1, 2, { x: [3, null] }],
    { model: "test", input: [{ role: "user", content: "hi" }], omitted: null },
  ]) {
    test(`round trip ${JSON.stringify(value)}`, () => {
      const result = run(JSON.stringify(value));
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toEqual(value);
    });
  }
  test("decimal lexemes are preserved without F32 conversion", () => {
    const result = run(
      '{"n":9007199254740993,"f":-0.1234567890123456789e+123}',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe(
      '{"n":9007199254740993,"f":-0.1234567890123456789e+123}',
    );
  });
  test("surrogate pairs from the ASCII wire", () => {
    expect(JSON.parse(run('"\\ud83d\\ude00"').stdout.toString())).toBe("😀");
  });
  for (const input of [
    "",
    "01",
    "-",
    "1.",
    "1e",
    "+1",
    "NaN",
    "[1,]",
    '{"a":1,}',
    "[",
    '{"a" 1}',
    '"\\uZZZZ"',
    '"\\ud800"',
    '"\\udc00"',
    '"\\x00"',
    '"\n"',
    "null false",
    "[true false]",
  ]) {
    test(`reject ${JSON.stringify(input)}`, () =>
      expect(run(input).exitCode).not.toBe(0));
  }
});
