import { assertEquals } from "@std/assert";
import { Engine } from "./engine.ts";

/**
 * FR-E91 end-to-end coverage for `isolation: worktree`. Every node is a
 * `command` node (FR-E88), so a whole workflow runs with no agent and no
 * network, and the isolation claim is observed on real files in a real git
 * repository.
 */

async function git(cwd: string, ...args: string[]): Promise<void> {
  const out = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!out.success) {
    throw new Error(
      `git ${args.join(" ")} failed: ${new TextDecoder().decode(out.stderr)}`,
    );
  }
}

const HEADER = [
  "name: isolated",
  "version: '1'",
  "defaults:",
  "  worktree_disabled: true",
  "nodes:",
].join("\n");

async function runWorkflow(
  body: string,
  runId: string,
): Promise<{ dir: string; state: Awaited<ReturnType<Engine["run"]>> }> {
  const dir = await Deno.makeTempDir();
  const origCwd = Deno.cwd();
  await Deno.mkdir(`${dir}/wf`, { recursive: true });
  await Deno.writeTextFile(`${dir}/wf/workflow.yaml`, `${HEADER}\n${body}\n`);
  await Deno.writeTextFile(`${dir}/src.txt`, "base\n");
  await git(dir, "init", "--initial-branch=main");
  await git(dir, "config", "user.email", "test@test.com");
  await git(dir, "config", "user.name", "Test");
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "init");
  try {
    Deno.chdir(dir);
    const engine = new Engine({
      config_path: "wf/workflow.yaml",
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

Deno.test("FR-E91 an isolated node's source edits stay out of the shared tree", async () => {
  const { dir, state } = await runWorkflow(
    [
      "  edit:",
      "    type: command",
      "    label: Edit",
      "    isolation: worktree",
      "    command: echo edited > src.txt && echo done > {{node_dir}}/out.txt",
    ].join("\n"),
    "run-iso-edit",
  );
  try {
    assertEquals(state.nodes.edit.status, "completed");
    // The edit landed in the node's own tree, not the shared one.
    assertEquals(await Deno.readTextFile(`${dir}/src.txt`), "base\n");
    // The artifact landed in the shared run directory, where downstream
    // nodes resolve {{input.edit}}.
    assertEquals(
      await Deno.readTextFile(`${dir}/wf/runs/run-iso-edit/edit/out.txt`),
      "done\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E91 a downstream node reads an isolated node's artifacts", async () => {
  const { dir, state } = await runWorkflow(
    [
      "  produce:",
      "    type: command",
      "    label: Produce",
      "    isolation: worktree",
      "    command: echo payload > {{node_dir}}/value.txt",
      "  consume:",
      "    type: command",
      "    label: Consume",
      "    inputs: [produce]",
      "    command: cp {{input.produce}}/value.txt {{node_dir}}/copied.txt",
    ].join("\n"),
    "run-iso-chain",
  );
  try {
    assertEquals(state.nodes.consume.status, "completed");
    assertEquals(
      await Deno.readTextFile(
        `${dir}/wf/runs/run-iso-chain/consume/copied.txt`,
      ),
      "payload\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E91 a successful isolated node leaves no worktree behind", async () => {
  const { dir } = await runWorkflow(
    [
      "  edit:",
      "    type: command",
      "    label: Edit",
      "    isolation: worktree",
      "    command: echo edited > src.txt",
    ].join("\n"),
    "run-iso-cleanup",
  );
  try {
    let exists = true;
    try {
      await Deno.stat(`${dir}/wf/runs/run-iso-cleanup/worktrees/edit`);
    } catch {
      exists = false;
    }
    assertEquals(exists, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E91 a failed isolated node keeps its worktree for diagnosis", async () => {
  const { dir, state } = await runWorkflow(
    [
      "  edit:",
      "    type: command",
      "    label: Edit",
      "    isolation: worktree",
      "    command: echo edited > src.txt && exit 3",
    ].join("\n"),
    "run-iso-preserve",
  );
  try {
    assertEquals(state.nodes.edit.status, "failed");
    assertEquals(
      await Deno.readTextFile(
        `${dir}/wf/runs/run-iso-preserve/worktrees/edit/src.txt`,
      ),
      "edited\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E91 each fan-out item of an isolated node gets its own tree", async () => {
  const { dir, state } = await runWorkflow(
    [
      "  list:",
      "    type: command",
      "    label: List",
      "    command: printf 'alpha\\nbeta\\n' > items.txt",
      "  work:",
      "    type: command",
      "    label: Work",
      "    inputs: [list]",
      "    isolation: worktree",
      "    for_each:",
      "      source: items.txt",
      "    command: echo {{each.value}} > src.txt && cp src.txt {{node_dir}}/copy.txt",
    ].join("\n"),
    "run-iso-fanout",
  );
  try {
    assertEquals(state.nodes.work.status, "completed");
    // Both items wrote the same file name in their own tree; neither reached
    // the shared one.
    assertEquals(await Deno.readTextFile(`${dir}/src.txt`), "base\n");
    assertEquals(
      await Deno.readTextFile(`${dir}/wf/runs/run-iso-fanout/work/0/copy.txt`),
      "alpha\n",
    );
    assertEquals(
      await Deno.readTextFile(`${dir}/wf/runs/run-iso-fanout/work/1/copy.txt`),
      "beta\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
