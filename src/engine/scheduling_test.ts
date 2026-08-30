import { assertEquals, assertRejects } from "@std/assert";
import { Engine } from "./engine.ts";
import { buildDependencies } from "./dag.ts";
import { parseConfig } from "../config/config.ts";

/**
 * FR-E97 scheduling coverage. A node starts when its own inputs are complete,
 * not when its DAG level is. Everything is observed through `command` nodes
 * (FR-E88) writing to one log file, so a whole workflow runs with no agent.
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
  "name: scheduling",
  "version: '1'",
  "defaults:",
  "  worktree_disabled: true",
  "  max_parallel: 2",
  "nodes:",
].join("\n");

Deno.test("FR-E97 a node starts when its own inputs finish, not its level", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      "  a1:",
      "    type: command",
      "    label: A1",
      "    command: echo a1 >> log.txt",
      "  a2:",
      "    type: command",
      "    label: A2",
      "    inputs: [a1]",
      "    command: echo a2 >> log.txt",
      "  b1:",
      "    type: command",
      "    label: B1",
      "    command: sleep 1 && echo b1 >> log.txt",
      "",
    ].join("\n"),
    "run-sched-rolling",
  );
  try {
    assertEquals(state.status, "completed");
    // Level scheduling would hold a2 behind b1, its level sibling; readiness
    // scheduling releases it as soon as a1 is done.
    assertEquals(
      (await Deno.readTextFile(`${dir}/log.txt`)).trim().split("\n"),
      ["a1", "a2", "b1"],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E97 a join node runs after every branch of its group", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      "  fast:",
      "    type: command",
      "    label: Fast",
      "    fork: g.fast",
      "    command: echo fast >> log.txt",
      "  slow:",
      "    type: command",
      "    label: Slow",
      "    fork: g.slow",
      "    command: sleep 1 && echo slow >> log.txt",
      "  integrate:",
      "    type: command",
      "    label: Integrate",
      "    join: g",
      "    command: echo integrate >> log.txt",
      "",
    ].join("\n"),
    "run-sched-join",
  );
  try {
    assertEquals(state.status, "completed");
    const lines = (await Deno.readTextFile(`${dir}/log.txt`)).trim().split(
      "\n",
    );
    assertEquals(lines[lines.length - 1], "integrate");
    assertEquals(lines.length, 3);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E97 a join depends on every terminal node of every branch", () => {
  const config = parseConfig(`
name: t
version: "1"
nodes:
  plan:
    type: command
    label: Plan
    command: "true"
  work-a:
    type: command
    label: A
    inputs: [plan]
    fork: g.a
    command: "true"
  check-a:
    type: command
    label: Check A
    inputs: [work-a]
    command: "true"
  work-b:
    type: command
    label: B
    inputs: [plan]
    fork: g.b
    command: "true"
  integrate:
    type: command
    label: Join
    join: g
    command: "true"
`);
  const deps = buildDependencies(config);
  // 'check-a' terminates branch a, 'work-b' terminates branch b; 'work-a' is
  // not a terminal, so the join does not name it.
  assertEquals([...deps.get("integrate")!].sort(), ["check-a", "work-b"]);
});

Deno.test("FR-E97 a cycle closed through a join edge fails at load", async () => {
  const dir = await Deno.makeTempDir();
  const origCwd = Deno.cwd();
  await Deno.writeTextFile(
    `${dir}/workflow.yaml`,
    [
      HEADER,
      "  work:",
      "    type: command",
      "    label: Work",
      "    inputs: [integrate]",
      "    fork: g.a",
      "    command: 'true'",
      "  integrate:",
      "    type: command",
      "    label: Join",
      "    join: g",
      "    command: 'true'",
      "",
    ].join("\n"),
  );
  try {
    Deno.chdir(dir);
    const engine = new Engine({
      config_path: "workflow.yaml",
      run_id: "run-sched-cycle",
      verbosity: "quiet",
      args: {},
      env_overrides: {},
      lock_path: "test.lock",
    });
    await assertRejects(() => engine.run(), Error, "Cycle detected");
  } finally {
    Deno.chdir(origCwd);
    await Deno.remove(dir, { recursive: true });
  }
});
