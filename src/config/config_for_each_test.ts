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

Deno.test("FR-E90 for_each parses with defaults applied", () => {
  const config = parseConfig(`${BASE}
  review:
    type: agent
    label: "Review"
    inputs: [build]
    for_each:
      source: "{{input.build}}/files.txt"
    prompt: "Review {{each.value}}"
`);
  assertEquals(
    config.nodes.review.for_each?.source,
    "{{input.build}}/files.txt",
  );
  assertEquals(config.nodes.review.for_each?.key_by, "index");
  assertEquals(config.nodes.review.for_each?.max_concurrent, 1);
  assertEquals(config.nodes.review.for_each?.failure_mode, "fail_fast");
});

Deno.test("FR-E90 for_each requires a non-empty source", () => {
  assertThrows(
    () =>
      parseConfig(`${BASE}
  review:
    type: command
    label: "Review"
    for_each:
      key_by: index
    command: "true"
`),
    Error,
    "requires a non-empty 'source'",
  );
});

Deno.test("FR-E90 for_each rejects an unknown key_by", () => {
  assertThrows(
    () =>
      parseConfig(`${BASE}
  review:
    type: command
    label: "Review"
    for_each:
      source: "files.txt"
      key_by: hash
    command: "true"
`),
    Error,
    "key_by must be 'index' or 'value'",
  );
});

Deno.test("FR-E90 for_each rejects an unknown failure_mode", () => {
  assertThrows(
    () =>
      parseConfig(`${BASE}
  review:
    type: command
    label: "Review"
    for_each:
      source: "files.txt"
      failure_mode: ignore
    command: "true"
`),
    Error,
    "failure_mode must be 'fail_fast' or 'collect'",
  );
});

Deno.test("FR-E90 for_each is rejected on node types that cannot fan out", () => {
  for (
    const [type, extra] of [
      [
        "loop",
        "    until: 'true'\n    nodes:\n      a:\n        type: agent\n        label: A\n        prompt: p",
      ],
      ["merge", "    merge_strategy: copy_all"],
      ["human", "    question: 'ok?'"],
    ]
  ) {
    assertThrows(
      () =>
        parseConfig(`${BASE}
  review:
    type: ${type}
    label: "Review"
    for_each:
      source: "files.txt"
${extra}
`),
      Error,
      "only valid on 'agent' and 'command' nodes",
    );
  }
});

Deno.test("FR-E90 each.* template variables are accepted only under for_each", () => {
  assertThrows(
    () =>
      parseConfig(`${BASE}
  review:
    type: command
    label: "Review"
    command: "echo {{each.value}}"
`),
    Error,
    "used outside a for_each node",
  );
});

Deno.test("FR-E90 an unknown each property is rejected", () => {
  assertThrows(
    () =>
      parseConfig(`${BASE}
  review:
    type: command
    label: "Review"
    for_each:
      source: "files.txt"
    command: "echo {{each.nonsense}}"
`),
    Error,
    "Unknown each property",
  );
});
