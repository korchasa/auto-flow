import { assertEquals, assertStringIncludes } from "@std/assert";
import { Engine } from "./engine.ts";

/**
 * FR-E90 end-to-end coverage. Fan-out is observed through `command` nodes
 * (FR-E88), so a whole workflow runs with no agent and no network.
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
  "name: fan-out",
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

Deno.test("FR-E90 a for_each node runs once per source item", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      LIST_NODE,
      "  review:",
      "    type: command",
      "    label: Review",
      "    inputs: [list]",
      "    for_each:",
      "      source: items.txt",
      "    command: echo {{each.value}} >> reviewed.txt",
      "",
    ].join("\n"),
    "run-fe-basic",
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

Deno.test("FR-E90 each item gets its own artifact directory", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      LIST_NODE,
      "  review:",
      "    type: command",
      "    label: Review",
      "    inputs: [list]",
      "    for_each:",
      "      source: items.txt",
      "    command: echo {{each.value}} > {{node_dir}}/name.txt",
      "",
    ].join("\n"),
    "run-fe-dirs",
  );
  try {
    assertEquals(state.nodes.review.status, "completed");
    const base = `${dir}/runs/run-fe-dirs/review`;
    assertEquals(
      (await Deno.readTextFile(`${base}/0/name.txt`)).trim(),
      "alpha",
    );
    assertEquals(
      (await Deno.readTextFile(`${base}/1/name.txt`)).trim(),
      "beta",
    );
    assertEquals(
      (await Deno.readTextFile(`${base}/2/name.txt`)).trim(),
      "gamma",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E90 key_by value names item directories after the item", async () => {
  const { dir } = await runWorkflow(
    [
      HEADER,
      LIST_NODE,
      "  review:",
      "    type: command",
      "    label: Review",
      "    inputs: [list]",
      "    for_each:",
      "      source: items.txt",
      "      key_by: value",
      "    command: echo {{each.index}} > {{node_dir}}/index.txt",
      "",
    ].join("\n"),
    "run-fe-keyby",
  );
  try {
    const base = `${dir}/runs/run-fe-keyby/review`;
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

Deno.test("FR-E90 fail_fast stops at the first failing item", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      LIST_NODE,
      "  review:",
      "    type: command",
      "    label: Review",
      "    inputs: [list]",
      "    for_each:",
      "      source: items.txt",
      "    command: 'echo {{each.value}} >> seen.txt; test {{each.value}} != beta'",
      "",
    ].join("\n"),
    "run-fe-failfast",
  );
  try {
    assertEquals(state.nodes.review.status, "failed");
    // alpha ran, beta failed, gamma never started.
    assertEquals(
      (await Deno.readTextFile(`${dir}/seen.txt`)).trim().split("\n"),
      ["alpha", "beta"],
    );
    assertStringIncludes(state.nodes.review.error ?? "", "item 1");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E90 failure_mode collect runs every item and reports all failures", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      LIST_NODE,
      "  review:",
      "    type: command",
      "    label: Review",
      "    inputs: [list]",
      "    for_each:",
      "      source: items.txt",
      "      failure_mode: collect",
      "    command: 'echo {{each.value}} >> seen.txt; test {{each.value}} = alpha'",
      "",
    ].join("\n"),
    "run-fe-collect",
  );
  try {
    assertEquals(state.nodes.review.status, "failed");
    assertEquals(
      (await Deno.readTextFile(`${dir}/seen.txt`)).trim().split("\n"),
      ["alpha", "beta", "gamma"],
    );
    assertStringIncludes(state.nodes.review.error ?? "", "2 of 3 items failed");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E90 an empty source completes the node without running anything", async () => {
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
      "    for_each:",
      "      source: items.txt",
      "    command: touch ran.txt",
      "  after:",
      "    type: command",
      "    label: After",
      "    inputs: [review]",
      "    command: touch after.txt",
      "",
    ].join("\n"),
    "run-fe-empty",
  );
  try {
    assertEquals(state.nodes.review.status, "completed");
    assertEquals(state.nodes.after.status, "completed");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E90 a missing source file fails the node with the path named", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      "  review:",
      "    type: command",
      "    label: Review",
      "    for_each:",
      "      source: nope.txt",
      "    command: touch ran.txt",
      "",
    ].join("\n"),
    "run-fe-missing",
  );
  try {
    assertEquals(state.nodes.review.status, "failed");
    assertStringIncludes(state.nodes.review.error ?? "", "nope.txt");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
