import { assertEquals, assertThrows } from "@std/assert";
import { parseConfig } from "./config.ts";

const BASE = `
name: t
version: "1"
nodes:
  build:
    type: agent
    label: "Build"
    prompt: "do it"
`;

Deno.test("FR-E88 command node parses with a command and inputs", () => {
  const config = parseConfig(`${BASE}
  tests:
    type: command
    label: "Run the suite"
    inputs: [build]
    command: "deno task check"
`);
  assertEquals(config.nodes.tests.type, "command");
  assertEquals(config.nodes.tests.command, "deno task check");
  assertEquals(config.nodes.tests.inputs, ["build"]);
});

Deno.test("FR-E88 command node requires a command", () => {
  assertThrows(
    () =>
      parseConfig(`${BASE}
  tests:
    type: command
    label: "Run the suite"
`),
    Error,
    "requires a non-empty 'command'",
  );
});

Deno.test("FR-E88 command node rejects an empty command", () => {
  assertThrows(
    () =>
      parseConfig(`${BASE}
  tests:
    type: command
    label: "Run the suite"
    command: ""
`),
    Error,
    "requires a non-empty 'command'",
  );
});

Deno.test("FR-E88 command field is rejected on a non-command node", () => {
  assertThrows(
    () =>
      parseConfig(`${BASE}
  other:
    type: agent
    label: "Other"
    prompt: "p"
    command: "echo hi"
`),
    Error,
    "only valid on 'command' nodes",
  );
});

Deno.test("FR-E88 command node rejects an agent-only prompt field", () => {
  assertThrows(
    () =>
      parseConfig(`${BASE}
  tests:
    type: command
    label: "Run"
    command: "true"
    prompt: "not allowed"
`),
    Error,
    "does not accept 'prompt'",
  );
});

Deno.test("FR-E88 command template variables are validated at load", () => {
  assertThrows(
    () =>
      parseConfig(`${BASE}
  tests:
    type: command
    label: "Run"
    command: "echo {{nonsense.value}}"
`),
    Error,
    "invalid template variables",
  );
});

Deno.test("FR-E88 command node accepts a validate block", () => {
  const config = parseConfig(`${BASE}
  tests:
    type: command
    label: "Run"
    command: "deno task check > {{node_dir}}/report.txt"
    validate:
      - type: file_not_empty
        path: "{{node_dir}}/report.txt"
`);
  assertEquals(config.nodes.tests.validate?.length, 1);
});

Deno.test("FR-E88 command node is allowed inside a loop body", () => {
  const config = parseConfig(`${BASE}
  fix:
    type: loop
    label: "Fix"
    until: "true"
    nodes:
      patch:
        type: agent
        label: "Patch"
        prompt: "fix"
      verify:
        type: command
        label: "Verify"
        inputs: [patch]
        command: "deno task check"
`);
  assertEquals(config.nodes.fix.nodes?.verify.type, "command");
});
