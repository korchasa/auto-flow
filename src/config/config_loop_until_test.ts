import { assertEquals, assertThrows } from "@std/assert";
import { parseConfig } from "./config.ts";

function loopConfig(loopBody: string): string {
  return `
name: t
version: "1"
nodes:
  work:
    type: loop
    label: "Work"
${loopBody}
    nodes:
      build:
        type: agent
        label: "Build"
        prompt: "do it"
`;
}

Deno.test("FR-E87 loop with `until` needs no condition triple", () => {
  const config = parseConfig(loopConfig(`    until: "deno task check"`));
  assertEquals(config.nodes.work.until, "deno task check");
  assertEquals(config.nodes.work.condition_node, undefined);
});

Deno.test("FR-E87 loop rejects `until` together with the condition triple", () => {
  assertThrows(
    () =>
      parseConfig(loopConfig(`    until: "true"
    condition_node: build
    condition_field: verdict
    exit_value: PASS`)),
    Error,
    "mutually exclusive",
  );
});

Deno.test("FR-E87 loop rejects `until` together with a partial triple", () => {
  assertThrows(
    () =>
      parseConfig(loopConfig(`    until: "true"
    exit_value: PASS`)),
    Error,
    "mutually exclusive",
  );
});

Deno.test("FR-E87 loop with neither `until` nor a condition triple is rejected", () => {
  assertThrows(
    () => parseConfig(loopConfig(`    max_iterations: 2`)),
    Error,
    "requires either 'until'",
  );
});

Deno.test("FR-E87 loop rejects a non-string `until`", () => {
  assertThrows(
    () => parseConfig(loopConfig(`    until: 42`)),
    Error,
    "must be a non-empty string",
  );
});

Deno.test("FR-E87 loop rejects an empty `until`", () => {
  assertThrows(
    () => parseConfig(loopConfig(`    until: ""`)),
    Error,
    "must be a non-empty string",
  );
});

Deno.test("FR-E87 `until` template variables are validated at load", () => {
  assertThrows(
    () => parseConfig(loopConfig(`    until: "test {{bogus.thing}}"`)),
    Error,
    "invalid template variables",
  );
});

Deno.test("FR-E87 the condition triple still works unchanged", () => {
  const config = parseConfig(loopConfig(`    condition_node: build
    condition_field: verdict
    exit_value: PASS`));
  assertEquals(config.nodes.work.condition_node, "build");
  assertEquals(config.nodes.work.until, undefined);
});
