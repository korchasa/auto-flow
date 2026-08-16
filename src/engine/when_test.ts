import { assertEquals } from "@std/assert";
import { Engine } from "./engine.ts";

/**
 * FR-E89 end-to-end coverage. Every node here is a `command` node (FR-E88),
 * so a full workflow runs with no agent, no runtime adapter and no network —
 * the gate's effect is observable as files that exist or do not.
 */
async function runWorkflow(
  yaml: string,
  runId: string,
  args: Record<string, string> = {},
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
      args,
      env_overrides: {},
      lock_path: "test.lock",
    });
    const state = await engine.run();
    return { dir, state };
  } finally {
    Deno.chdir(origCwd);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

const HEADER = [
  "name: when-gate",
  "version: '1'",
  "defaults:",
  "  worktree_disabled: true",
  "nodes:",
].join("\n");

Deno.test("FR-E89 a node whose when predicate fails is skipped", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      "  always:",
      "    type: command",
      "    label: Always",
      "    command: touch always.txt",
      "  gated:",
      "    type: command",
      "    label: Gated",
      "    inputs: [always]",
      "    when: 'false'",
      "    command: touch gated.txt",
      "",
    ].join("\n"),
    "run-when-skip",
  );
  try {
    assertEquals(state.nodes.always.status, "completed");
    assertEquals(state.nodes.gated.status, "skipped");
    assertEquals(await exists(`${dir}/always.txt`), true);
    assertEquals(await exists(`${dir}/gated.txt`), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E89 a node whose when predicate passes runs", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      "  gated:",
      "    type: command",
      "    label: Gated",
      "    when: 'true'",
      "    command: touch gated.txt",
      "",
    ].join("\n"),
    "run-when-run",
  );
  try {
    assertEquals(state.nodes.gated.status, "completed");
    assertEquals(await exists(`${dir}/gated.txt`), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E89 the skip propagates to dependents of a gated node", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      "  gated:",
      "    type: command",
      "    label: Gated",
      "    when: 'false'",
      "    command: touch gated.txt",
      "  downstream:",
      "    type: command",
      "    label: Downstream",
      "    inputs: [gated]",
      "    command: touch downstream.txt",
      "",
    ].join("\n"),
    "run-when-propagate",
  );
  try {
    assertEquals(state.nodes.gated.status, "skipped");
    assertEquals(state.nodes.downstream.status, "skipped");
    assertEquals(await exists(`${dir}/downstream.txt`), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E89 when reads workflow arguments", async () => {
  const yaml = [
    HEADER,
    "  gated:",
    "    type: command",
    "    label: Gated",
    "    when: \"test '{{args.mode}}' = full\"",
    "    command: touch gated.txt",
    "",
  ].join("\n");

  const full = await runWorkflow(yaml, "run-when-args-full", { mode: "full" });
  try {
    assertEquals(full.state.nodes.gated.status, "completed");
  } finally {
    await Deno.remove(full.dir, { recursive: true });
  }

  const quick = await runWorkflow(yaml, "run-when-args-quick", {
    mode: "quick",
  });
  try {
    assertEquals(quick.state.nodes.gated.status, "skipped");
  } finally {
    await Deno.remove(quick.dir, { recursive: true });
  }
});

Deno.test("FR-E89 a gated branch does not fail the run", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      "  gated:",
      "    type: command",
      "    label: Gated",
      "    when: 'false'",
      "    command: exit 9",
      "  after:",
      "    type: command",
      "    label: After",
      "    command: touch after.txt",
      "",
    ].join("\n"),
    "run-when-not-failure",
  );
  try {
    assertEquals(state.nodes.gated.status, "skipped");
    assertEquals(state.nodes.after.status, "completed");
    assertEquals(state.status, "completed");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E89 a loop-body gate is re-evaluated every iteration", async () => {
  const { dir, state } = await runWorkflow(
    [
      HEADER,
      "  fix:",
      "    type: loop",
      "    label: Fix",
      "    until: 'test $(cat counter.txt | wc -l) -ge 3'",
      "    max_iterations: 5",
      "    nodes:",
      "      bump:",
      "        type: command",
      "        label: Bump",
      "        command: echo mark >> counter.txt",
      "      late:",
      "        type: command",
      "        label: Late",
      "        inputs: [bump]",
      // Runs only from the second iteration onward.
      "        when: 'test {{loop.iteration}} -gt 1'",
      "        command: echo late >> late.txt",
      "",
    ].join("\n"),
    "run-when-loop",
  );
  try {
    assertEquals(state.nodes.fix.status, "completed");
    // Three iterations bump the counter; the gate opens on iterations 2 and 3.
    assertEquals(
      (await Deno.readTextFile(`${dir}/counter.txt`)).trim(),
      [
        "mark",
        "mark",
        "mark",
      ].join("\n"),
    );
    assertEquals(
      (await Deno.readTextFile(`${dir}/late.txt`)).trim(),
      ["late", "late"].join("\n"),
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
