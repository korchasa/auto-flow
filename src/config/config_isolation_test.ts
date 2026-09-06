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

Deno.test("FR-E91 isolation: worktree parses on an agent node", () => {
  const config = parseConfig(`${BASE}
    isolation: worktree
`);
  assertEquals(config.nodes.build.isolation, "worktree");
});

Deno.test("FR-E91 isolation: worktree parses on a command node", () => {
  const config = parseConfig(`${BASE}
  check:
    type: command
    label: "Check"
    isolation: worktree
    command: "true"
`);
  assertEquals(config.nodes.check.isolation, "worktree");
});

Deno.test("FR-E91 isolation is absent by default", () => {
  const config = parseConfig(BASE);
  assertEquals(config.nodes.build.isolation, undefined);
});

Deno.test("FR-E91 isolation rejects a value other than 'worktree'", () => {
  assertThrows(
    () =>
      parseConfig(`${BASE}
    isolation: container
`),
    Error,
    "'isolation' must be 'worktree'",
  );
});

Deno.test("FR-E91 isolation is rejected on a merge node", () => {
  assertThrows(
    () =>
      parseConfig(`${BASE}
  gather:
    type: merge
    label: "Gather"
    inputs: [build]
    isolation: worktree
`),
    Error,
    "only valid on 'agent' and 'command' nodes",
  );
});

Deno.test("FR-E91 isolation is rejected on a human node", () => {
  assertThrows(
    () =>
      parseConfig(`${BASE}
  approve:
    type: human
    label: "Approve"
    prompt: "ok?"
    isolation: worktree
`),
    Error,
    "only valid on 'agent' and 'command' nodes",
  );
});

Deno.test("FR-E100 session target in another worktree is rejected", () => {
  // The target sits in a worktree of its own: the session's cwd is not ours.
  assertThrows(
    () =>
      parseConfig(`${BASE}
    isolation: worktree
  fix:
    type: agent
    label: "Fix"
    inputs: [build]
    session: build
    prompt: "fix it"
`),
    Error,
    "Node 'fix' cannot continue the session of 'build': the two nodes run in different trees",
  );

  // A fork branch that declares allowed_paths gets a tree per branch (FR-E91).
  assertThrows(
    () =>
      parseConfig(`${BASE}
    fork: g.a
    allowed_paths: ["src/**"]
  fix:
    type: agent
    label: "Fix"
    inputs: [build]
    session: build
    prompt: "fix it"
  done:
    type: command
    label: "Done"
    join: g
    command: "true"
`),
    Error,
    "Node 'fix' cannot continue the session of 'build': the two nodes run in different trees",
  );
});
