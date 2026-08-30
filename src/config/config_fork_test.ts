import { assertEquals, assertThrows } from "@std/assert";
import { parseConfig, resolveBranchMembership } from "./config.ts";

const BASE = `
name: t
version: "1"
nodes:
  plan:
    type: agent
    label: "Plan"
    prompt: "do it"
`;

/** A two-static-branch group with a join, the shape most tests start from. */
function group(extraWork = "", extraJoin = ""): string {
  return `${BASE}
  work-a:
    type: agent
    label: "A"
    inputs: [plan]
    fork: g.a
    prompt: "a"
${extraWork}
  work-b:
    type: agent
    label: "B"
    inputs: [plan]
    fork: g.b
    prompt: "b"
  integrate:
    type: command
    label: "Join"
    join: g
    command: "true"
${extraJoin}`;
}

Deno.test("FR-E95 fork string form names a group and a branch", () => {
  const config = parseConfig(group());
  assertEquals(config.nodes["work-a"].fork, "g.a");
  assertEquals(config.nodes.integrate.join, "g");
});

Deno.test("FR-E95 fork string form rejects a name that is not group.branch", () => {
  for (const bad of ["g", "g.a.b", ".a", "g.", ""]) {
    assertThrows(
      () =>
        parseConfig(`${BASE}
  work:
    type: agent
    label: "W"
    fork: "${bad}"
    prompt: "w"
  integrate:
    type: command
    label: "J"
    join: g
    command: "true"
`),
      Error,
      "fork",
    );
  }
});

Deno.test("FR-E95 fork object form requires group and branches", () => {
  const config = parseConfig(`${BASE}
  work:
    type: agent
    label: "W"
    inputs: [plan]
    fork:
      group: g
      branches: "{{input.plan}}/tasks.json"
      key: value.id
      max_concurrent: 3
    prompt: "{{branch.value.prompt}}"
  integrate:
    type: command
    label: "J"
    join: g
    command: "true"
`);
  const fork = config.nodes.work.fork;
  assertEquals(typeof fork === "string" ? null : fork?.group, "g");
  assertEquals(
    typeof fork === "string" ? null : fork?.branches,
    "{{input.plan}}/tasks.json",
  );
  assertEquals(typeof fork === "string" ? null : fork?.key, "value.id");
  assertEquals(typeof fork === "string" ? null : fork?.max_concurrent, 3);

  assertThrows(
    () =>
      parseConfig(`${BASE}
  work:
    type: agent
    label: "W"
    fork:
      group: g
    prompt: "w"
  integrate:
    type: command
    label: "J"
    join: g
    command: "true"
`),
    Error,
    "branches",
  );
});

Deno.test("FR-E95 fork is rejected on node types that cannot run a branch", () => {
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
  work:
    type: ${type}
    label: "W"
    fork: g.a
${extra}
  integrate:
    type: command
    label: "J"
    join: g
    command: "true"
`),
      Error,
      "only valid on 'agent' and 'command' nodes",
    );
  }
});

Deno.test("FR-E95 a group with no join node is rejected", () => {
  assertThrows(
    () =>
      parseConfig(`${BASE}
  work:
    type: agent
    label: "W"
    inputs: [plan]
    fork: g.a
    prompt: "w"
`),
    Error,
    "no 'join'",
  );
});

Deno.test("FR-E95 a join naming a group nothing forks into is rejected", () => {
  assertThrows(
    () =>
      parseConfig(`${BASE}
  integrate:
    type: command
    label: "J"
    join: nope
    command: "true"
`),
    Error,
    "no node forks into it",
  );
});

Deno.test("FR-E95 two join nodes for one group are rejected", () => {
  assertThrows(
    () =>
      parseConfig(group(
        "",
        `  integrate2:
    type: command
    label: "J2"
    join: g
    command: "true"
`,
      )),
    Error,
    "more than one 'join'",
  );
});

Deno.test("FR-E95 a node carrying both fork and join is rejected", () => {
  assertThrows(
    () =>
      parseConfig(`${BASE}
  work:
    type: command
    label: "W"
    fork: g.a
    join: g
    command: "true"
`),
    Error,
    "both 'fork' and 'join'",
  );
});

Deno.test("FR-E95 two fork nodes declaring the same branch are rejected", () => {
  assertThrows(
    () =>
      parseConfig(`${BASE}
  work-a:
    type: agent
    label: "A"
    fork: g.a
    prompt: "a"
  work-a2:
    type: agent
    label: "A2"
    fork: g.a
    prompt: "a"
  integrate:
    type: command
    label: "J"
    join: g
    command: "true"
`),
    Error,
    "declared twice",
  );
});

Deno.test("FR-E95 branch membership propagates along inputs to the join", () => {
  const config = parseConfig(group(`  check-a:
    type: command
    label: "Check A"
    inputs: [work-a]
    command: "true"
`));
  const membership = resolveBranchMembership(config);
  assertEquals(membership.get("work-a"), { group: "g", branch: "a" });
  assertEquals(membership.get("check-a"), { group: "g", branch: "a" });
  assertEquals(membership.get("work-b"), { group: "g", branch: "b" });
  assertEquals(membership.get("plan"), undefined);
  assertEquals(membership.get("integrate"), undefined);
});

Deno.test("FR-E95 a node fed by two branches of one group must be the join", () => {
  assertThrows(
    () =>
      parseConfig(group(`  mixer:
    type: command
    label: "Mixer"
    inputs: [work-a, work-b]
    command: "true"
`)),
    Error,
    "two branches",
  );
});

Deno.test("FR-E95 failure_mode belongs to the join node", () => {
  const config = parseConfig(group(
    "",
    `    failure_mode: collect
`,
  ));
  assertEquals(config.nodes.integrate.failure_mode, "collect");

  assertThrows(
    () =>
      parseConfig(group(`    failure_mode: collect
`)),
    Error,
    "only valid on a 'join' node",
  );

  assertThrows(
    () =>
      parseConfig(group(
        "",
        `    failure_mode: ignore
`,
      )),
    Error,
    "failure_mode must be",
  );
});

Deno.test("FR-E95 branch.* template variables are accepted only inside a branch", () => {
  parseConfig(group(`  use:
    type: command
    label: "Use"
    inputs: [work-a]
    command: "echo {{branch.key}} {{branch.index}} {{branch.value.id}}"
`));

  assertThrows(
    () =>
      parseConfig(`${BASE}
  solo:
    type: command
    label: "Solo"
    command: "echo {{branch.key}}"
`),
    Error,
    "used outside a branch",
  );
});

Deno.test("FR-E95 an unknown branch property is rejected", () => {
  assertThrows(
    () =>
      parseConfig(group(`    prompt2: x
`)),
    Error,
    "unknown key",
  );
  assertThrows(
    () =>
      parseConfig(group(`  use:
    type: command
    label: "Use"
    inputs: [work-a]
    command: "echo {{branch.nonsense}}"
`)),
    Error,
    "Unknown branch property",
  );
});

Deno.test("FR-E90 for_each is rejected and names fork as its replacement", () => {
  assertThrows(
    () =>
      parseConfig(`${BASE}
  work:
    type: agent
    label: "W"
    for_each:
      source: "files.txt"
    prompt: "w"
`),
    Error,
    "'for_each' was replaced by 'fork'",
  );
});

Deno.test("FR-E97 fork and join are rejected inside a loop body", () => {
  for (const field of ["fork: g.a", "join: g"]) {
    assertThrows(
      () =>
        parseConfig(`${BASE}
  cycle:
    type: loop
    label: "Loop"
    until: "true"
    nodes:
      body:
        type: command
        label: Body
        ${field}
        command: "true"
`),
      Error,
      "not allowed inside a loop body",
    );
  }
});

Deno.test("FR-E97 a loop node may not sit inside a branch", () => {
  assertThrows(
    () =>
      parseConfig(group(`  cycle:
    type: loop
    label: "Loop"
    inputs: [work-a]
    until: "true"
    nodes:
      step:
        type: command
        label: Step
        command: "true"
`)),
    Error,
    "loop node 'cycle' belongs to branch 'g.a'",
  );
});
