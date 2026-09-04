import { assertEquals } from "@std/assert";
import { Engine } from "./engine.ts";
import type { RunState } from "../types.ts";

/**
 * FR-E99 / FR-E11 / FR-E89 / FR-E34 coverage for the outcome wave: the nodes
 * that wait for the run's verdict are scheduled by the same `runNodes` and
 * gated by the same `gateNode` as every other node.
 *
 * Every workflow here is built from `command` nodes, so the tests exercise the
 * real engine end to end without an agent runtime.
 */
async function writeWorkflow(dir: string, body: string[]): Promise<void> {
  await Deno.writeTextFile(
    `${dir}/workflow.yaml`,
    ["name: outcome", "version: '1'", ...body, ""].join("\n"),
  );
}

async function runEngine(
  dir: string,
  runId: string,
  opts: { resume?: boolean; only?: string[] } = {},
): Promise<RunState> {
  const origCwd = Deno.cwd();
  try {
    Deno.chdir(dir);
    const engine = new Engine({
      config_path: "workflow.yaml",
      run_id: runId,
      resume: opts.resume,
      only_nodes: opts.only,
      verbosity: "quiet",
      args: {},
      env_overrides: {},
      lock_path: "test.lock",
    });
    return await engine.run();
  } finally {
    Deno.chdir(origCwd);
  }
}

/** Workflow whose graph node fails, plus the given post-workflow node lines. */
function failingGraph(post: string[]): string[] {
  return [
    "defaults:",
    "  worktree_disabled: true",
    "nodes:",
    "  graph:",
    "    type: command",
    "    label: Graph",
    "    command: exit 1",
    ...post,
  ];
}

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

async function countLines(path: string): Promise<number> {
  try {
    const text = await Deno.readTextFile(path);
    return text.split("\n").filter((l) => l.length > 0).length;
  } catch {
    return 0;
  }
}

Deno.test("FR-E99 when gates a run_on node", async () => {
  await withDir(async (dir) => {
    await writeWorkflow(
      dir,
      failingGraph([
        "  post:",
        "    type: command",
        "    label: Post",
        "    run_on: always",
        "    when: exit 1",
        "    command: touch post-ran.txt",
      ]),
    );
    const state = await runEngine(dir, "run-gate");
    assertEquals(state.nodes.post.status, "skipped");
    assertEquals(await countLines(`${dir}/post-ran.txt`), 0);
  });
});

Deno.test("FR-E99 run outcome resolves in a template and in a predicate", async () => {
  await withDir(async (dir) => {
    await writeWorkflow(
      dir,
      failingGraph([
        "  post:",
        "    type: command",
        "    label: Post",
        "    run_on: always",
        "    command: sh -c 'echo {{run.outcome}}/{{run.attempt}} > outcome.txt'",
      ]),
    );
    const state = await runEngine(dir, "run-tpl");
    assertEquals(state.nodes.post.status, "completed");
    assertEquals(
      (await Deno.readTextFile(`${dir}/outcome.txt`)).trim(),
      "failure/1",
    );
  });
});

Deno.test("FR-E11 run_on filters against the run outcome", async () => {
  await withDir(async (dir) => {
    await writeWorkflow(
      dir,
      failingGraph([
        "  p-always:",
        "    type: command",
        "    label: Always",
        "    run_on: always",
        "    command: 'true'",
        "  p-success:",
        "    type: command",
        "    label: Success",
        "    run_on: success",
        "    command: 'true'",
        "  p-failure:",
        "    type: command",
        "    label: Failure",
        "    run_on: failure",
        "    command: 'true'",
      ]),
    );
    const state = await runEngine(dir, "run-filter");
    assertEquals(state.nodes["p-always"].status, "completed");
    assertEquals(state.nodes["p-success"].status, "skipped");
    assertEquals(state.nodes["p-failure"].status, "completed");
  });
});

/** Graph fails on both attempts; one `always` node and one `every_attempt`. */
function resumeWorkflow(): string[] {
  return failingGraph([
    "  p-always:",
    "    type: command",
    "    label: Always",
    "    run_on: always",
    "    command: sh -c 'echo x >> marker-a.txt'",
    "  p-every:",
    "    type: command",
    "    label: Every",
    "    run_on: every_attempt",
    "    command: sh -c 'echo x >> marker-e.txt'",
  ]);
}

Deno.test("FR-E11 an every_attempt node is not re-entered within one attempt", async () => {
  await withDir(async (dir) => {
    await writeWorkflow(dir, resumeWorkflow());
    const state = await runEngine(dir, "run-once");
    assertEquals(state.nodes["p-every"].status, "completed");
    assertEquals(await countLines(`${dir}/marker-e.txt`), 1);
    assertEquals(state.attempt, 1);
  });
});

Deno.test("FR-E11 resume re-runs an every_attempt node", async () => {
  await withDir(async (dir) => {
    await writeWorkflow(dir, resumeWorkflow());
    await runEngine(dir, "run-re");
    const state = await runEngine(dir, "run-re", { resume: true });
    assertEquals(state.attempt, 2);
    assertEquals(state.nodes["p-every"].status, "completed");
    assertEquals(state.nodes["p-every"].completed_attempt, 2);
    assertEquals(await countLines(`${dir}/marker-e.txt`), 2);
  });
});

Deno.test("FR-E11 resume leaves a completed always node alone", async () => {
  await withDir(async (dir) => {
    await writeWorkflow(dir, resumeWorkflow());
    await runEngine(dir, "run-keep");
    const state = await runEngine(dir, "run-keep", { resume: true });
    assertEquals(state.nodes["p-always"].status, "completed");
    assertEquals(state.nodes["p-always"].completed_attempt, 1);
    assertEquals(await countLines(`${dir}/marker-a.txt`), 1);
  });
});

Deno.test("FR-E89 when composes with every_attempt", async () => {
  await withDir(async (dir) => {
    await writeWorkflow(
      dir,
      failingGraph([
        "  post:",
        "    type: command",
        "    label: Post",
        "    run_on: every_attempt",
        '    when: test "{{run.outcome}}" = "success"',
        "    command: touch post-ran.txt",
      ]),
    );
    const state = await runEngine(dir, "run-compose");
    assertEquals(state.nodes.post.status, "skipped");
    assertEquals(await countLines(`${dir}/post-ran.txt`), 0);
  });
});

Deno.test("FR-E34 a failed outcome-wave node is journalled and does not stop its siblings", async () => {
  await withDir(async (dir) => {
    await writeWorkflow(dir, [
      "defaults:",
      "  worktree_disabled: true",
      "nodes:",
      "  graph:",
      "    type: command",
      "    label: Graph",
      "    command: 'true'",
      "  post-a-fail:",
      "    type: command",
      "    label: Fail",
      "    run_on: always",
      "    command: exit 3",
      "  post-b-ok:",
      "    type: command",
      "    label: Ok",
      "    run_on: always",
      "    command: sh -c 'echo x >> sibling-ran.txt'",
    ]);
    const state = await runEngine(dir, "run-sibling");
    assertEquals(state.nodes["post-a-fail"].status, "failed");
    assertEquals(state.nodes["post-b-ok"].status, "completed");
    assertEquals(await countLines(`${dir}/sibling-ran.txt`), 1);
    // The graph's own verdict is what the run reports; a post-workflow
    // failure is recorded but does not rewrite it.
    assertEquals(state.status, "completed");
  });
});

Deno.test("FR-E34 the failure hook fires with no run_on nodes present", async () => {
  await withDir(async (dir) => {
    await Deno.writeTextFile(
      `${dir}/hook.sh`,
      "#!/bin/bash\necho x >> hook-ran.txt\n",
    );
    await Deno.chmod(`${dir}/hook.sh`, 0o755);
    await writeWorkflow(dir, [
      "defaults:",
      "  worktree_disabled: true",
      "  on_failure_script: ./hook.sh",
      "nodes:",
      "  graph:",
      "    type: command",
      "    label: Graph",
      "    command: exit 1",
    ]);
    const state = await runEngine(dir, "run-hook");
    assertEquals(state.status, "failed");
    // Exactly once per attempt — the hook is not re-entered per node.
    assertEquals(await countLines(`${dir}/hook-ran.txt`), 1);
  });
});

Deno.test("FR-E34 the failure hook does not fire when the graph succeeded", async () => {
  await withDir(async (dir) => {
    await Deno.writeTextFile(
      `${dir}/hook.sh`,
      "#!/bin/bash\necho x >> hook-ran.txt\n",
    );
    await Deno.chmod(`${dir}/hook.sh`, 0o755);
    await writeWorkflow(dir, [
      "defaults:",
      "  worktree_disabled: true",
      "  on_failure_script: ./hook.sh",
      "nodes:",
      "  graph:",
      "    type: command",
      "    label: Graph",
      "    command: 'true'",
      "  post:",
      "    type: command",
      "    label: Post",
      "    run_on: always",
      "    command: 'true'",
    ]);
    const state = await runEngine(dir, "run-nohook");
    assertEquals(state.status, "completed");
    assertEquals(await countLines(`${dir}/hook-ran.txt`), 0);
  });
});

Deno.test("FR-E99 the outcome wave respects dependencies between its own nodes", async () => {
  await withDir(async (dir) => {
    await writeWorkflow(dir, [
      "defaults:",
      "  worktree_disabled: true",
      "nodes:",
      "  graph:",
      "    type: command",
      "    label: Graph",
      "    command: 'true'",
      "  z-first:",
      "    type: command",
      "    label: First",
      "    run_on: always",
      "    command: sh -c 'echo first >> order.txt'",
      "  a-second:",
      "    type: command",
      "    label: Second",
      "    inputs: [z-first]",
      "    run_on: always",
      "    command: sh -c 'echo second >> order.txt'",
    ]);
    const state = await runEngine(dir, "run-order");
    assertEquals(state.nodes["a-second"].status, "completed");
    // Alphabetical order would start with `a-second`; the dependency wins.
    assertEquals(
      (await Deno.readTextFile(`${dir}/order.txt`)).trim().split("\n"),
      ["first", "second"],
    );
  });
});

Deno.test("FR-E99 --only selects an outcome-wave node", async () => {
  await withDir(async (dir) => {
    await writeWorkflow(dir, [
      "defaults:",
      "  worktree_disabled: true",
      "nodes:",
      "  graph:",
      "    type: command",
      "    label: Graph",
      "    command: touch graph-ran.txt",
      "  post:",
      "    type: command",
      "    label: Post",
      "    run_on: always",
      "    command: touch post-ran.txt",
    ]);
    const state = await runEngine(dir, "run-only", { only: ["post"] });
    assertEquals(state.nodes.graph.status, "skipped");
    assertEquals(state.nodes.post.status, "completed");
    assertEquals(await countLines(`${dir}/graph-ran.txt`), 0);
  });
});

Deno.test("FR-E99 an outcome-wave node downstream of a skipped input is skipped", async () => {
  await withDir(async (dir) => {
    await writeWorkflow(dir, [
      "defaults:",
      "  worktree_disabled: true",
      "nodes:",
      "  graph:",
      "    type: command",
      "    label: Graph",
      "    when: exit 1",
      "    command: 'true'",
      "  post:",
      "    type: command",
      "    label: Post",
      "    inputs: [graph]",
      "    run_on: always",
      "    command: touch post-ran.txt",
    ]);
    const state = await runEngine(dir, "run-downstream");
    assertEquals(state.nodes.graph.status, "skipped");
    assertEquals(state.nodes.post.status, "skipped");
    assertEquals(await countLines(`${dir}/post-ran.txt`), 0);
  });
});

Deno.test("FR-E34 a failed wave node skips its dependants instead of stalling the wave", async () => {
  await withDir(async (dir) => {
    await writeWorkflow(dir, [
      "defaults:",
      "  worktree_disabled: true",
      "nodes:",
      "  graph:",
      "    type: command",
      "    label: Graph",
      "    command: 'true'",
      "  notify:",
      "    type: command",
      "    label: Notify",
      "    run_on: always",
      "    command: exit 1",
      "  after-notify:",
      "    type: command",
      "    label: After notify",
      "    run_on: always",
      "    inputs: [notify]",
      "    command: touch after.txt",
    ]);

    // The wave keeps going after one of its nodes fails (FR-E34), so the
    // dependant must be skipped for want of its input rather than left
    // unreachable — an unreachable node makes the scheduler throw
    // "Cannot resolve dependencies", which would take down a run the graph
    // had already completed.
    const state = await runEngine(dir, "run-wave-dependant");

    assertEquals(state.nodes.notify.status, "failed");
    assertEquals(state.nodes["after-notify"].status, "skipped");
    assertEquals(state.status, "completed");

    let ran = true;
    try {
      await Deno.stat(`${dir}/after.txt`);
    } catch {
      ran = false;
    }
    assertEquals(ran, false);
  });
});

Deno.test("FR-E34 a failed graph node outside any branch still stops the run", async () => {
  await withDir(async (dir) => {
    await writeWorkflow(dir, [
      "defaults:",
      "  worktree_disabled: true",
      "nodes:",
      "  first:",
      "    type: command",
      "    label: First",
      "    command: exit 1",
      "  second:",
      "    type: command",
      "    label: Second",
      "    inputs: [first]",
      "    command: touch second.txt",
    ]);

    // Regression lock for the branch-absorption rule: only a node inside a
    // fork group under `collect` / `all_or_nothing` may be absorbed. An
    // ordinary node takes the run down with it, and its dependant is never
    // reached — neither skipped nor run.
    const state = await runEngine(dir, "run-plain-failure");

    assertEquals(state.nodes.first.status, "failed");
    assertEquals(state.nodes.second.status, "pending");
    assertEquals(state.status, "failed");
  });
});
