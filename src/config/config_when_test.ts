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

Deno.test("FR-E89 when is accepted on any node type", () => {
  const config = parseConfig(`${BASE}
  gated:
    type: command
    label: "Gated"
    inputs: [build]
    when: "test -f report.md"
    command: "deno task check"
  gated-agent:
    type: agent
    label: "Gated agent"
    when: "test -f report.md"
    prompt: "review"
`);
  assertEquals(config.nodes.gated.when, "test -f report.md");
  assertEquals(config.nodes["gated-agent"].when, "test -f report.md");
});

Deno.test("FR-E89 when must be a non-empty string", () => {
  assertThrows(
    () =>
      parseConfig(`${BASE}
  gated:
    type: agent
    label: "Gated"
    prompt: "p"
    when: ""
`),
    Error,
    "'when' must be a non-empty string",
  );
});

Deno.test("FR-E89 when template variables are validated at load", () => {
  assertThrows(
    () =>
      parseConfig(`${BASE}
  gated:
    type: agent
    label: "Gated"
    prompt: "p"
    when: "test -f {{nonsense.value}}"
`),
    Error,
    "invalid template variables",
  );
});

Deno.test("FR-E89 when is accepted on a loop body node", () => {
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
        when: "test -f todo.md"
`);
  assertEquals(config.nodes.fix.nodes?.patch.when, "test -f todo.md");
});
