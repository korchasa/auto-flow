import { assertEquals, assertThrows } from "@std/assert";
import { effectiveAllowedPaths, isolatedBranches } from "./branch-scope.ts";
import { globsOverlap } from "./glob.ts";
import { parseConfig, resolveBranchMembership } from "../config/config.ts";

const CONFIG = `
name: t
version: "1"
nodes:
  plan:
    type: command
    label: Plan
    command: "true"
  writes:
    type: command
    label: Writes
    inputs: [plan]
    fork: g.writes
    allowed_paths: ["src/api/**"]
    command: "true"
  writes-check:
    type: command
    label: Check
    inputs: [writes]
    command: "true"
  judges:
    type: command
    label: Judges
    inputs: [plan]
    fork: g.judges
    command: "true"
  integrate:
    type: command
    label: Join
    join: g
    command: "true"
`;

Deno.test("FR-E91 a branch is isolated when any of its nodes declares a write scope", () => {
  const config = parseConfig(CONFIG);
  assertEquals([...isolatedBranches(config)].sort(), ["g.writes"]);
});

Deno.test("FR-E37 a branch node that declares no scope may write nothing", () => {
  const config = parseConfig(CONFIG);
  const membership = resolveBranchMembership(config);
  // Declared scope is kept as written.
  assertEquals(
    effectiveAllowedPaths(config.nodes.writes, membership.has("writes")),
    ["src/api/**"],
  );
  // Inside a branch with nothing declared, the empty scope turns the FR-E37
  // check on instead of leaving it off.
  assertEquals(effectiveAllowedPaths(config.nodes.judges, true), []);
  // Outside a branch the historical "absent means no check" stands.
  assertEquals(effectiveAllowedPaths(config.nodes.plan, false), undefined);
});

Deno.test("FR-E37 globsOverlap proves two scopes disjoint or reports overlap", () => {
  assertEquals(globsOverlap("src/api/**", "src/web/**"), false);
  assertEquals(globsOverlap("docs/**", "src/**"), false);
  assertEquals(globsOverlap("src/**", "src/api/**"), true);
  assertEquals(globsOverlap("src/a.ts", "src/a.ts"), true);
  assertEquals(globsOverlap("src/*.ts", "src/a.ts"), true);
  assertEquals(globsOverlap("src/a.ts", "src/b.ts"), false);
});

Deno.test("FR-E37 two branches of one group may not share a write scope", () => {
  assertThrows(
    () =>
      parseConfig(`
name: t
version: "1"
nodes:
  a:
    type: command
    label: A
    fork: g.a
    allowed_paths: ["src/**"]
    command: "true"
  b:
    type: command
    label: B
    fork: g.b
    allowed_paths: ["src/api/**"]
    command: "true"
  integrate:
    type: command
    label: J
    join: g
    command: "true"
`),
    Error,
    "overlapping write scopes",
  );
});

Deno.test("FR-E95 a node may not inherit membership from a runtime fork", () => {
  assertThrows(
    () =>
      parseConfig(`
name: t
version: "1"
nodes:
  work:
    type: command
    label: W
    fork:
      group: g
      branches: tasks.json
    command: "true"
  after:
    type: command
    label: After
    inputs: [work]
    command: "true"
  integrate:
    type: command
    label: J
    join: g
    command: "true"
`),
    Error,
    "one node long",
  );
});
