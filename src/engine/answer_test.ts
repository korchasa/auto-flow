import { assertEquals } from "@std/assert";
import { Engine } from "./engine.ts";
import { createFakeRuntime } from "../testing/fake-runtime.ts";

/**
 * FR-E96 coverage: every node leaves an answer, and a join node receives the
 * answers of its group's branches as files it can read.
 */
async function runWorkflow(
  body: string,
  runId: string,
  agentAnswer?: string,
): Promise<{ dir: string; state: Awaited<ReturnType<Engine["run"]>> }> {
  const dir = await Deno.makeTempDir();
  const origCwd = Deno.cwd();
  await Deno.writeTextFile(
    `${dir}/workflow.yaml`,
    [
      "name: answers",
      "version: '1'",
      "defaults:",
      "  worktree_disabled: true",
      "nodes:",
      body,
      "",
    ].join("\n"),
  );
  try {
    Deno.chdir(dir);
    const engine = new Engine({
      config_path: "workflow.yaml",
      run_id: runId,
      verbosity: "quiet",
      args: {},
      env_overrides: {},
      lock_path: "test.lock",
      runtimeAdapter: agentAnswer === undefined
        ? undefined
        : createFakeRuntime(({ reply }) => reply({ result: agentAnswer })),
    });
    const state = await engine.run();
    return { dir, state };
  } finally {
    Deno.chdir(origCwd);
  }
}

Deno.test("FR-E96 a command node's answer is its stdout", async () => {
  const { dir, state } = await runWorkflow(
    [
      "  say:",
      "    type: command",
      "    label: Say",
      "    command: echo hello",
    ].join("\n"),
    "run-ans-stdout",
  );
  try {
    assertEquals(state.nodes.say.status, "completed");
    assertEquals(
      await Deno.readTextFile(`${dir}/runs/run-ans-stdout/say/.answer`),
      "hello\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E96 an after hook's stdout replaces the answer", async () => {
  const { dir, state } = await runWorkflow(
    [
      "  say:",
      "    type: command",
      "    label: Say",
      "    command: echo ignored",
      "    after: echo 'the patch'",
    ].join("\n"),
    "run-ans-hook",
  );
  try {
    assertEquals(state.nodes.say.status, "completed");
    assertEquals(
      await Deno.readTextFile(`${dir}/runs/run-ans-hook/say/.answer`),
      "the patch\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E96 a join node receives its group's branch answers", async () => {
  const { dir, state } = await runWorkflow(
    [
      "  a:",
      "    type: command",
      "    label: A",
      "    fork: g.a",
      "    command: echo from-a",
      "  b:",
      "    type: command",
      "    label: B",
      "    fork: g.b",
      "    command: echo from-b",
      "  integrate:",
      "    type: command",
      "    label: Integrate",
      "    join: g",
      "    command: cat {{node_dir}}/branches/*/*.answer > {{node_dir}}/all.txt",
    ].join("\n"),
    "run-ans-join",
  );
  try {
    assertEquals(state.nodes.integrate.status, "completed");
    const joinDir = `${dir}/runs/run-ans-join/integrate`;
    assertEquals(
      await Deno.readTextFile(`${joinDir}/branches/a/a.answer`),
      "from-a\n",
    );
    assertEquals(
      await Deno.readTextFile(`${joinDir}/branches/b/b.answer`),
      "from-b\n",
    );
    const manifest = JSON.parse(
      await Deno.readTextFile(`${joinDir}/branches.json`),
    );
    assertEquals(manifest.group, "g");
    assertEquals(
      manifest.branches.map((b: { branch: string }) => b.branch).sort(),
      ["a", "b"],
    );
    assertEquals(manifest.branches[0].status, "completed");
    assertEquals(manifest.branches[0].nodes[0].answer, "branches/a/a.answer");
    // The join could read them as ordinary files.
    assertEquals(
      (await Deno.readTextFile(`${joinDir}/all.txt`)).trim().split("\n").sort(),
      ["from-a", "from-b"],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E96 an agent node's answer is its final message", async () => {
  const { dir, state } = await runWorkflow(
    [
      "  think:",
      "    type: agent",
      "    label: Think",
      "    runtime: opencode",
      "    prompt: decide",
    ].join("\n"),
    "run-ans-agent",
    "VERDICT: PASS",
  );
  try {
    assertEquals(state.nodes.think.status, "completed");
    assertEquals(
      await Deno.readTextFile(`${dir}/runs/run-ans-agent/think/.answer`),
      "VERDICT: PASS",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
