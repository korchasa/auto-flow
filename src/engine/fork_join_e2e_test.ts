import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { Engine } from "./engine.ts";

/**
 * FR-E95 end-to-end coverage. Branch expansion is observed through `command`
 * nodes (FR-E88), so a whole workflow runs with no agent and no network.
 */
async function runWorkflow(
  yaml: string,
  runId: string,
): Promise<{ dir: string; state: Awaited<ReturnType<Engine["run"]>> }> {
  const dir = await Deno.makeTempDir();
  const origCwd = Deno.cwd();
  await Deno.writeTextFile(`${dir}/workflow.yaml`, yaml);
  try {
    Deno.chdir(dir);
    const engine = new Engine({
      config_path: "workflow.yaml",
      run_id: runId,
      verbosity: "quiet",
      args: {},
      env_overrides: {},
      lock_path: "test.lock",
    });
    const state = await engine.run();
    return { dir, state };
  } finally {
    Deno.chdir(origCwd);
  }
}

const HEADER = [
  "name: fork-join",
  "version: '1'",
  "defaults:",
  "  worktree_disabled: true",
  "nodes:",
].join("\n");

const LIST_NODE = [
  "  list:",
  "    type: command",
  "    label: List",
  "    command: printf 'alpha\\nbeta\\ngamma\\n' > items.txt",
].join("\n");

const JOIN_NODE = (extra = "") =>
  [
    "  integrate:",
    "    type: command",
    "    label: Integrate",
    "    join: g",
    extra,
    "    command: touch joined.txt",
  ].filter((line) => line !== "").join("\n");

Deno.test("FR-E95 a fork node runs once per branch of its source", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      LIST_NODE,
      "  review:",
      "    type: command",
      "    label: Review",
      "    inputs: [list]",
      "    fork:",
      "      group: g",
      "      branches: items.txt",
      "    command: echo {{branch.value}} >> reviewed.txt",
      JOIN_NODE(),
      "",
    ].join("\n"),
    "run-fk-basic",
  );
  try {
    assertEquals(state.nodes.review.status, "completed");
    assertEquals(
      (await Deno.readTextFile(`${dir}/reviewed.txt`)).trim().split("\n"),
      ["alpha", "beta", "gamma"],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E95 each branch gets its own artifact directory", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      LIST_NODE,
      "  review:",
      "    type: command",
      "    label: Review",
      "    inputs: [list]",
      "    fork:",
      "      group: g",
      "      branches: items.txt",
      "    command: echo {{branch.value}} > {{node_dir}}/name.txt",
      JOIN_NODE(),
      "",
    ].join("\n"),
    "run-fk-dirs",
  );
  try {
    assertEquals(state.nodes.review.status, "completed");
    const base = `${dir}/runs/run-fk-dirs/review`;
    assertEquals(
      (await Deno.readTextFile(`${base}/0/name.txt`)).trim(),
      "alpha",
    );
    assertEquals(
      (await Deno.readTextFile(`${base}/2/name.txt`)).trim(),
      "gamma",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E95 key value names branch directories after the item", async () => {
  const { dir } = await runWorkflow(
    [
      HEADER,
      LIST_NODE,
      "  review:",
      "    type: command",
      "    label: Review",
      "    inputs: [list]",
      "    fork:",
      "      group: g",
      "      branches: items.txt",
      "      key: value",
      "    command: echo {{branch.index}} > {{node_dir}}/index.txt",
      JOIN_NODE(),
      "",
    ].join("\n"),
    "run-fk-key",
  );
  try {
    const base = `${dir}/runs/run-fk-key/review`;
    assertEquals(
      (await Deno.readTextFile(`${base}/alpha/index.txt`)).trim(),
      "0",
    );
    assertEquals(
      (await Deno.readTextFile(`${base}/gamma/index.txt`)).trim(),
      "2",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E95 object branches carry their own instructions and name", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      "  list:",
      "    type: command",
      "    label: List",
      "    command: >-",
      `      printf '%s' '[{"id":"api","word":"alpha"},{"id":"web","word":"beta"}]'`,
      "      > tasks.json",
      "  review:",
      "    type: command",
      "    label: Review",
      "    inputs: [list]",
      "    fork:",
      "      group: g",
      "      branches: tasks.json",
      "      key: value.id",
      "    command: echo {{branch.value.word}} > {{node_dir}}/word.txt",
      JOIN_NODE(),
      "",
    ].join("\n"),
    "run-fk-objects",
  );
  try {
    assertEquals(state.nodes.review.status, "completed");
    const base = `${dir}/runs/run-fk-objects/review`;
    assertEquals(
      (await Deno.readTextFile(`${base}/api/word.txt`)).trim(),
      "alpha",
    );
    assertEquals(
      (await Deno.readTextFile(`${base}/web/word.txt`)).trim(),
      "beta",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E95 fail_fast stops the group at the first failing branch", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      LIST_NODE,
      "  review:",
      "    type: command",
      "    label: Review",
      "    inputs: [list]",
      "    fork:",
      "      group: g",
      "      branches: items.txt",
      "      key: value",
      "    command: 'echo {{branch.value}} >> seen.txt; test {{branch.value}} != beta'",
      JOIN_NODE(),
      "",
    ].join("\n"),
    "run-fk-failfast",
  );
  try {
    assertEquals(state.nodes.review.status, "failed");
    // alpha ran, beta failed, gamma never started.
    assertEquals(
      (await Deno.readTextFile(`${dir}/seen.txt`)).trim().split("\n"),
      ["alpha", "beta"],
    );
    assertStringIncludes(state.nodes.review.error ?? "", "branch beta");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E95 failure_mode collect on the join runs every branch and reports all failures", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      LIST_NODE,
      "  review:",
      "    type: command",
      "    label: Review",
      "    inputs: [list]",
      "    fork:",
      "      group: g",
      "      branches: items.txt",
      "      key: value",
      "    command: 'echo {{branch.value}} >> seen.txt; test {{branch.value}} = alpha'",
      JOIN_NODE("    failure_mode: collect"),
      "",
    ].join("\n"),
    "run-fk-collect",
  );
  try {
    assertEquals(state.nodes.review.status, "failed");
    assertEquals(
      (await Deno.readTextFile(`${dir}/seen.txt`)).trim().split("\n"),
      ["alpha", "beta", "gamma"],
    );
    assertStringIncludes(
      state.nodes.review.error ?? "",
      "2 of 3 branches failed",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E95 an empty branch list completes the node without running anything", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      "  list:",
      "    type: command",
      "    label: List",
      "    command: 'true > items.txt'",
      "  review:",
      "    type: command",
      "    label: Review",
      "    inputs: [list]",
      "    fork:",
      "      group: g",
      "      branches: items.txt",
      "    command: touch ran.txt",
      JOIN_NODE(),
      "  after:",
      "    type: command",
      "    label: After",
      "    inputs: [integrate]",
      "    command: touch after.txt",
      "",
    ].join("\n"),
    "run-fk-empty",
  );
  try {
    assertEquals(state.nodes.review.status, "completed");
    assertEquals(state.nodes.after.status, "completed");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E95 a missing branch source fails the node with the path named", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      "  review:",
      "    type: command",
      "    label: Review",
      "    fork:",
      "      group: g",
      "      branches: nope.txt",
      "    command: touch ran.txt",
      JOIN_NODE(),
      "",
    ].join("\n"),
    "run-fk-missing",
  );
  try {
    assertEquals(state.nodes.review.status, "failed");
    assertStringIncludes(state.nodes.review.error ?? "", "nope.txt");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E95 a static branch's nodes resolve branch.key and branch.index", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      "  work-a:",
      "    type: command",
      "    label: A",
      "    fork: g.alpha",
      "    command: echo {{branch.key}}-{{branch.index}} > {{node_dir}}/who.txt",
      "  check-a:",
      "    type: command",
      "    label: Check A",
      "    inputs: [work-a]",
      "    command: echo {{branch.key}} > {{node_dir}}/who.txt",
      "  work-b:",
      "    type: command",
      "    label: B",
      "    fork: g.beta",
      "    command: echo {{branch.key}}-{{branch.index}} > {{node_dir}}/who.txt",
      "  integrate:",
      "    type: command",
      "    label: Integrate",
      "    join: g",
      "    command: 'true'",
      "",
    ].join("\n"),
    "run-static-branch-vars",
  );
  try {
    assertEquals(state.nodes.integrate.status, "completed");
    const read = (node: string) =>
      Deno.readTextFile(`${dir}/runs/run-static-branch-vars/${node}/who.txt`);
    // The branch names itself, and its index is its position in the group.
    assertEquals(await read("work-a"), "alpha-0\n");
    assertEquals(await read("work-b"), "beta-1\n");
    // A node that inherited the branch sees the same name …
    assertEquals(await read("check-a"), "alpha\n");
    // … and its artifacts stay in its own directory, not a per-branch subdir.
    assertEquals(state.nodes["check-a"].status, "completed");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E95 a runtime branch key colliding with a static branch fails before any branch runs", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      "  list:",
      "    type: command",
      "    label: List",
      "    command: printf 'alpha\\nbeta\\n' > items.txt",
      "  alpha:",
      "    type: command",
      "    label: Alpha",
      "    inputs: [list]",
      "    fork: g.alpha",
      "    command: touch alpha-ran.txt",
      "  review:",
      "    type: command",
      "    label: Review",
      "    inputs: [list]",
      "    fork:",
      "      group: g",
      "      branches: items.txt",
      "      key: value",
      "    command: 'echo {{branch.value}} >> seen.txt'",
      JOIN_NODE(),
      "",
    ].join("\n"),
    "run-fk-collide",
  );
  try {
    assertEquals(state.nodes.review.status, "failed");
    assertStringIncludes(
      state.nodes.review.error ?? "",
      "collides with a static branch",
    );
    // Expansion failed, so not one branch of the group ran.
    await assertRejects(() => Deno.stat(`${dir}/seen.txt`));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/** A group of two static branches, each one node, sharing one join. */
const STATIC_GROUP = (alphaCmd: string, betaCmd: string, joinExtra = "") =>
  [
    HEADER,
    "  alpha:",
    "    type: command",
    "    label: Alpha",
    "    fork: g.alpha",
    `    command: '${alphaCmd}'`,
    "  beta:",
    "    type: command",
    "    label: Beta",
    "    fork: g.beta",
    `    command: '${betaCmd}'`,
    JOIN_NODE(joinExtra),
    "",
  ].join("\n");

Deno.test("FR-E95 static branches: collect runs the join and records the failed branch", async () => {
  const { dir, state } = await runWorkflow(
    STATIC_GROUP(
      "echo alpha >> seen.txt; false",
      "echo beta >> seen.txt",
      "    failure_mode: collect",
    ),
    "run-fk-static-collect",
  );
  try {
    assertEquals(state.nodes.alpha.status, "failed");
    assertEquals(state.nodes.beta.status, "completed");
    // Every branch ran, and the join was not held back by the failed one.
    assertEquals(
      (await Deno.readTextFile(`${dir}/seen.txt`)).trim().split("\n").sort(),
      ["alpha", "beta"],
    );
    assertEquals(state.nodes.integrate.status, "completed");

    const manifest = JSON.parse(
      await Deno.readTextFile(
        `${dir}/runs/run-fk-static-collect/integrate/branches.json`,
      ),
    ) as { branches: { branch: string; status: string }[] };
    assertEquals(
      manifest.branches.map((b) => [b.branch, b.status]),
      [["alpha", "failed"], ["beta", "completed"]],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E95 static branches: all_or_nothing lets siblings finish but skips the join", async () => {
  const { dir, state } = await runWorkflow(
    STATIC_GROUP(
      "echo alpha >> seen.txt; false",
      "echo beta >> seen.txt",
      "    failure_mode: all_or_nothing",
    ),
    "run-fk-static-aon",
  );
  try {
    assertEquals(state.nodes.alpha.status, "failed");
    assertEquals(state.nodes.beta.status, "completed");
    assertEquals(state.nodes.integrate.status, "skipped");
    assertEquals(state.status, "failed");
    await assertRejects(() => Deno.stat(`${dir}/joined.txt`));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E95 static branches: fail_fast stops the group at the first failure", async () => {
  const { dir, state } = await runWorkflow(
    STATIC_GROUP("echo alpha >> seen.txt; false", "echo beta >> seen.txt"),
    "run-fk-static-failfast",
  );
  try {
    assertEquals(state.nodes.alpha.status, "failed");
    // beta never started, and neither did the join.
    assertEquals(state.nodes.beta?.status, "pending");
    assertEquals(state.nodes.integrate?.status, "pending");
    assertEquals(state.status, "failed");
    await assertRejects(() => Deno.stat(`${dir}/joined.txt`));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
