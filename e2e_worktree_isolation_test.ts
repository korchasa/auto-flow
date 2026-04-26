/**
 * @module
 * End-to-end acceptance suite for worktree-isolation hardening
 * (FR-E50, FR-E51). Each scenario stands up an ad-hoc git repo in a temp
 * dir (bare origin + working clone) so the engine can create a real worktree
 * via `createWorktree` (which fetches from `origin/main`), then exercises
 * the integrated guardrail/branch-pin flow against a simulated agent.
 *
 * No real CLI runtime is invoked — the agent's filesystem effects are
 * replicated directly in-test (writing files, making commits) inside the
 * `runWithGuardrail` wrapper or before `pinDetachedHead`. This mirrors the
 * runtime path in `node-dispatch.ts::executeAgentNode` where the guardrail
 * wraps `runAgent`. The contract being verified is the engine-side behavior
 * (snapshot/detect/rollback for FR-E50, detached-HEAD pin for FR-E51) and
 * its end-to-end effect on the main repo's working tree and ref namespace.
 *
 * Per-test timeout: ~30s (git operations only, no network beyond local
 * file:// remote, no LLM).
 */

import { assertEquals } from "@std/assert";
import { runWithGuardrail } from "./guardrail.ts";
import { createWorktree, pinDetachedHead, removeWorktree } from "./worktree.ts";

/** Run a git command in `cwd`. Throws with stderr context on failure. */
async function git(cwd: string, ...args: string[]): Promise<string> {
  const out = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) {
    const stderr = new TextDecoder().decode(out.stderr).trim();
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${stderr}`);
  }
  return new TextDecoder().decode(out.stdout).trim();
}

/**
 * Stand up a (bare-origin, working-clone) pair so that `createWorktree`'s
 * `git fetch origin main` succeeds and `git worktree add origin/main` finds
 * the ref. Returns the absolute path of the working clone.
 */
async function setupRepoPair(): Promise<{ origin: string; clone: string }> {
  const origin = await Deno.makeTempDir({ prefix: "e2e-origin-" });
  const clone = await Deno.makeTempDir({ prefix: "e2e-clone-" });

  await git(origin, "init", "--bare", "--initial-branch=main");

  const cloneRes = await new Deno.Command("git", {
    args: ["clone", origin, clone],
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!cloneRes.success) {
    throw new Error(
      `git clone failed: ${new TextDecoder().decode(cloneRes.stderr)}`,
    );
  }

  await git(clone, "config", "user.email", "test@test.com");
  await git(clone, "config", "user.name", "Test");
  await git(clone, "checkout", "-b", "main");
  await Deno.writeTextFile(`${clone}/README.md`, "init\n");
  // Ignore the worktrees dir so its presence doesn't pollute `git status`
  // on main — same convention as the real repo's root `.gitignore`.
  await Deno.writeTextFile(
    `${clone}/.gitignore`,
    ".flowai-workflow/worktrees/\n",
  );
  await git(clone, "add", "README.md", ".gitignore");
  await git(clone, "commit", "-m", "init");
  await git(clone, "push", "-u", "origin", "main");
  await Deno.mkdir(`${clone}/.flowai-workflow/worktrees`, { recursive: true });
  return { origin, clone };
}

/**
 * Run `body` with `Deno.cwd()` switched to `cwd`. Restores the original cwd
 * even on throw. Required because `createWorktree` and `runWithGuardrail`
 * use the engine's cwd as the repo root.
 */
async function withCwd<T>(cwd: string, body: () => Promise<T>): Promise<T> {
  const orig = Deno.cwd();
  Deno.chdir(cwd);
  try {
    return await body();
  } finally {
    Deno.chdir(orig);
  }
}

Deno.test("e2e — happy path leaves main clean (FR-E50, FR-E51)", async () => {
  const { origin, clone } = await setupRepoPair();
  try {
    await withCwd(clone, async () => {
      const runId = "e2e-happy-001";
      const workDir = await createWorktree(runId);

      // Simulate an agent that writes only inside its assigned workDir —
      // exactly the contract the guardrail must accept.
      const outcome = await runWithGuardrail(
        {
          repoRoot: clone,
          workDir,
          allowedPaths: [],
          nodeId: "build",
        },
        async () => {
          await Deno.writeTextFile(
            `${clone}/${workDir}/legitimate.md`,
            "agent output\n",
          );
          return "ok";
        },
      );

      assertEquals(outcome.leak, undefined, "no leak expected on happy path");
      assertEquals(outcome.result, "ok");

      // FR-E51: rescue-branch pin before teardown. Worktree is on detached
      // HEAD by default (createWorktree uses --detach), so a rescue branch
      // SHOULD be created even when no commits were made — the branch points
      // at the worktree HEAD (== origin/main here).
      const rescue = await pinDetachedHead(workDir, runId);
      assertEquals(typeof rescue, "string");
      assertEquals(rescue, `flowai/run-${runId}-orphan-rescue`);

      // Main working tree must be clean — the file lives in the worktree.
      const status = await git(clone, "status", "--porcelain");
      assertEquals(status, "", "main working tree must be clean");

      await removeWorktree(workDir);
    });
  } finally {
    await Deno.remove(origin, { recursive: true });
    await Deno.remove(clone, { recursive: true });
  }
});

Deno.test("e2e — abs-path leak triggers guardrail (FR-E50)", async () => {
  const { origin, clone } = await setupRepoPair();
  try {
    await withCwd(clone, async () => {
      const runId = "e2e-leak-001";
      const workDir = await createWorktree(runId);
      const messages: string[] = [];

      // Simulate an agent that misroutes a write to the main repo via
      // absolute path — the exact failure class FR-E50 was added to defend
      // against (issue #196 v3, kazar-fairy-taler incidents).
      const outcome = await runWithGuardrail(
        {
          repoRoot: clone,
          workDir,
          allowedPaths: [],
          nodeId: "build",
          log: (m) => messages.push(m),
        },
        async () => {
          await Deno.writeTextFile(
            `${clone}/leaked.md`,
            "should not survive\n",
          );
          return { success: true };
        },
      );

      assertEquals(outcome.leak?.paths, ["leaked.md"]);
      assertEquals(messages.length, 1);
      assertEquals(messages[0].includes("node=build"), true);
      assertEquals(messages[0].includes("leaked.md"), true);
      assertEquals(messages[0].includes("rolled back"), true);

      // Main is restored: the leaked file was rolled back (untracked → unlinked).
      const exists = await Deno.stat(`${clone}/leaked.md`).then(
        () => true,
        () => false,
      );
      assertEquals(exists, false, "leaked file must be removed by rollback");

      const status = await git(clone, "status", "--porcelain");
      assertEquals(status, "", "main working tree must be restored to clean");

      await removeWorktree(workDir);
    });
  } finally {
    await Deno.remove(origin, { recursive: true });
    await Deno.remove(clone, { recursive: true });
  }
});

Deno.test("e2e — detached HEAD pins to rescue branch (FR-E51)", async () => {
  const { origin, clone } = await setupRepoPair();
  try {
    await withCwd(clone, async () => {
      const runId = "e2e-detached-001";
      const workDir = await createWorktree(runId);
      const absWorkDir = `${clone}/${workDir}`;

      // Simulate an in-worktree commit that lives only on detached HEAD.
      // Without FR-E51, removing the worktree would orphan this commit.
      await git(absWorkDir, "config", "user.email", "test@test.com");
      await git(absWorkDir, "config", "user.name", "Test");
      await Deno.writeTextFile(`${absWorkDir}/orphan.md`, "rescue-me\n");
      await git(absWorkDir, "add", "orphan.md");
      await git(absWorkDir, "commit", "-m", "would-be-orphan");
      const orphanSha = await git(absWorkDir, "rev-parse", "HEAD");

      // FR-E51: pin BEFORE removeWorktree. Pre-removal HEAD is detached so
      // a rescue branch must be created.
      const rescue = await pinDetachedHead(absWorkDir, runId);
      assertEquals(rescue, `flowai/run-${runId}-orphan-rescue`);

      // Branch ref exists in the main repo and points at the orphan commit.
      const branchSha = await git(
        clone,
        "rev-parse",
        `refs/heads/${rescue}`,
      );
      assertEquals(branchSha, orphanSha);

      await removeWorktree(workDir);

      // After teardown, the rescue branch is still reachable in main —
      // the orphan commit survives garbage-collection eligibility.
      const survives = await git(
        clone,
        "rev-parse",
        `refs/heads/${rescue}`,
      );
      assertEquals(survives, orphanSha);

      // And the commit itself is reachable via the branch.
      const reach = await git(clone, "cat-file", "-t", branchSha);
      assertEquals(reach, "commit");
    });
  } finally {
    await Deno.remove(origin, { recursive: true });
    await Deno.remove(clone, { recursive: true });
  }
});
