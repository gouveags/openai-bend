export {};
// Ship the README as Bend comments, with links that also work on the Hub.
const readme = await Bun.file("README.md").text();
const linked = readme.replace(
  /\]\(\.\/([^)]*)\)/g,
  (_, target: string) =>
    `](https://github.com/gouveags/openai-bend/${target === "examples" ? "tree" : "blob"}/main/${target})`,
);
const contents =
  "# An unofficial OpenAI SDK for Bend, with typed requests, streaming, and tool calling.\n\nimport Base\n\n" +
  linked
    .split("\n")
    .map((line) => ("# " + line).trimEnd())
    .join("\n") +
  '\n\ndef repository() -> String:\n  "https://github.com/gouveags/openai-bend"\n\ndef version() -> String:\n  "0.1.0"\n';
await Bun.write("docs.bend", contents);
