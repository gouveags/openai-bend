export {};
// The Hub includes imported Bend sources, so ship the README as Bend comments.
const readme = await Bun.file("README.md").text();
const withoutHub = readme.replace(
  /<!-- hub:start -->[\s\S]*?<!-- hub:end -->\n?/g,
  "",
);
const contents =
  "# An unofficial OpenAI SDK for Bend, with typed requests, streaming, and tool calling.\n\nimport Base\n\n" +
  withoutHub
    .split("\n")
    .map((line) => ("# " + line).trimEnd())
    .join("\n") +
  '\n\ndef repository() -> String:\n  "https://github.com/gouveags/openai-bend"\n\ndef version() -> String:\n  "0.1.0"\n';
await Bun.write("docs.bend", contents);
