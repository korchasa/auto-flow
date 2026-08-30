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

Deno.test("FR-E91 each branch of an isolated fork node gets its own tree", async () => {
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
      "    fork:",
      "      group: g",
      "      branches: items.txt",
      "    command: echo {{branch.value}} > src.txt && cp src.txt {{node_dir}}/copy.txt",
      "  integrate:",
      "    type: command",
      "    label: Integrate",
      "    join: g",
      "    command: 'true'",
    ].join("\n"),
    "run-iso-fanout",
  );
  try {
    assertEquals(state.nodes.work.status, "completed");
    // Both branches wrote the same file name in their own tree; neither reached
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

Deno.test("FR-E91 a branch's nodes share one tree, and the shared tree keeps none of it", async () => {
  const { dir, state } = await runWorkflow(
    [
      "  edit:",
      "    type: command",
      "    label: Edit",
      "    fork: g.a",
      "    allowed_paths: ['src.txt']",
      "    command: echo edited > src.txt",
      "  check:",
      "    type: command",
      "    label: Check",
      "    inputs: [edit]",
      "    command: cp src.txt {{node_dir}}/seen.txt",
      "  integrate:",
      "    type: command",
      "    label: Integrate",
      "    join: g",
      "    command: 'true'",
    ].join("\n"),
    "run-branch-tree",
  );
  try {
    assertEquals(state.nodes.check.status, "completed");
    assertEquals(state.nodes.integrate.status, "completed");
    // The second node of the branch saw the first one's edit …
    assertEquals(
      await Deno.readTextFile(
        `${dir}/wf/runs/run-branch-tree/check/seen.txt`,
      ),
      "edited\n",
    );
    // … and the run's shared tree never received it.
    assertEquals(await Deno.readTextFile(`${dir}/src.txt`), "base\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E96 two code-editing branches return patches an authored join applies", async () => {
  const { dir, state } = await runWorkflow(
    [
      "  edit-existing:",
      "    type: command",
      "    label: Edit existing",
      "    fork: g.existing",
      "    allowed_paths: ['src.txt']",
      "    command: echo edited > src.txt",
      "    after: git add -A -N . && git diff",
      "  add-new:",
      "    type: command",
      "    label: Add new",
      "    fork: g.new",
      "    allowed_paths: ['new.txt']",
      "    command: echo brand-new > new.txt",
      "    after: git add -A -N . && git diff",
      "  integrate:",
      "    type: command",
      "    label: Integrate",
      "    join: g",
      "    command: >-",
      '      for p in {{node_dir}}/branches/*/*.answer; do git apply "$p"; done',
    ].join("\n"),
    "run-branch-patch",
  );
  try {
    assertEquals(state.nodes.integrate.status, "completed");
    // Each branch edited in its own tree; the join replayed both patches into
    // the run's tree — the modification and the newly created file alike.
    assertEquals(await Deno.readTextFile(`${dir}/src.txt`), "edited\n");
    assertEquals(await Deno.readTextFile(`${dir}/new.txt`), "brand-new\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E91 a branch tree survives until its last node, not its first terminal", async () => {
  const { dir, state } = await runWorkflow(
    [
      "  edit:",
      "    type: command",
      "    label: Edit",
      "    fork: g.a",
      "    allowed_paths: ['src.txt']",
      "    command: echo edited > src.txt",
      "  check-one:",
      "    type: command",
      "    label: Check one",
      "    inputs: [edit]",
      "    command: cp src.txt {{node_dir}}/seen.txt",
      "  check-two:",
      "    type: command",
      "    label: Check two",
      "    inputs: [edit]",
      "    command: cp src.txt {{node_dir}}/seen.txt",
      "  integrate:",
      "    type: command",
      "    label: Integrate",
      "    join: g",
      "    command: 'true'",
    ].join("\n"),
    "run-branch-two-tails",
  );
  try {
    // Both ends of the branch are terminals of it; whichever finishes first
    // must not take the tree away from the other.
    for (const node of ["check-one", "check-two"]) {
      assertEquals(state.nodes[node].status, "completed");
      assertEquals(
        await Deno.readTextFile(
          `${dir}/wf/runs/run-branch-two-tails/${node}/seen.txt`,
        ),
        "edited\n",
      );
    }
    assertEquals(state.nodes.integrate.status, "completed");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
