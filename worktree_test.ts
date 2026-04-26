import { assertEquals } from "@std/assert";
import {
  copyToOriginalRepo,
  createWorktree,
  getWorktreePath,
  pinDetachedHead,
  removeWorktree,
  worktreeExists,
} from "./worktree.ts";

Deno.test("getWorktreePath — returns <workflowDir>/runs/<runId>/worktree (FR-E57)", () => {
  assertEquals(
    getWorktreePath("20260408T120000", ".flowai-workflow/example"),
    ".flowai-workflow/example/runs/20260408T120000/worktree",
  );
});

Deno.test("getWorktreePath — distinct workflow dirs produce disjoint paths (FR-E57)", () => {
  const runId = "RUN";
  const a = getWorktreePath(runId, ".flowai-workflow/wf-a");
  const b = getWorktreePath(runId, ".flowai-workflow/wf-b");
  assertEquals(a, ".flowai-workflow/wf-a/runs/RUN/worktree");
  assertEquals(b, ".flowai-workflow/wf-b/runs/RUN/worktree");
  assertEquals(a === b, false);
});

Deno.test("getWorktreePath — includes label in runId (FR-E57)", () => {
  assertEquals(
    getWorktreePath("20260408T120000-my-feature", ".flowai-workflow/example"),
    ".flowai-workflow/example/runs/20260408T120000-my-feature/worktree",
  );
});

Deno.test("worktreeExists — returns false for non-existent worktree (FR-E57)", () => {
  assertEquals(
    worktreeExists("nonexistent-run-id-abc123", ".flowai-workflow/example"),
    false,
  );
});

Deno.test("worktreeExists — falls back to legacy path when only legacy exists (FR-E57)", async () => {
  const tmp = await Deno.makeTempDir();
  const origCwd = Deno.cwd();
  try {
    Deno.chdir(tmp);
    // Set up only the legacy layout — no new-layout dir.
    const runId = "legacy-run-id";
    await Deno.mkdir(`.flowai-workflow/worktrees/${runId}`, {
      recursive: true,
    });
    assertEquals(worktreeExists(runId, ".flowai-workflow/example"), true);
  } finally {
    Deno.chdir(origCwd);
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("worktreeExists — prefers new layout over legacy (FR-E57)", async () => {
  const tmp = await Deno.makeTempDir();
  const origCwd = Deno.cwd();
  try {
    Deno.chdir(tmp);
    const runId = "preferred-run-id";
    const workflowDir = ".flowai-workflow/example";
    // Both paths exist; new path should win.
    await Deno.mkdir(`${workflowDir}/runs/${runId}/worktree`, {
      recursive: true,
    });
    await Deno.mkdir(`.flowai-workflow/worktrees/${runId}`, {
      recursive: true,
    });
    assertEquals(worktreeExists(runId, workflowDir), true);
  } finally {
    Deno.chdir(origCwd);
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("removeWorktree — swallows error for non-existent worktree", async () => {
  // Should not throw for a path that doesn't exist
  await removeWorktree("/tmp/nonexistent-worktree-abc123");
});

Deno.test("removeWorktree — prunes stale gitlink after manual dir removal (FR-E57)", async () => {
  const { tmpOrigin, tmpClone } = await setupOriginAndClone();
  const origCwd = Deno.cwd();
  try {
    Deno.chdir(tmpClone);
    const runId = "prune-test";
    const workflowDir = ".flowai-workflow/example";
    const worktreePath = await createWorktree(runId, workflowDir);

    // git stores its bookkeeping under .git/worktrees/<basename>, where
    // <basename> is derived from the worktree path's leaf and may be
    // disambiguated on collision. Discover the actual entry rather than
    // assuming a name.
    const gitlinkRoot = `${tmpClone}/.git/worktrees`;
    const beforeEntries: string[] = [];
    for await (const e of Deno.readDir(gitlinkRoot)) {
      if (e.isDirectory) beforeEntries.push(e.name);
    }
    assertEquals(
      beforeEntries.length,
      1,
      `expected exactly one gitlink entry, got: ${beforeEntries.join(",")}`,
    );

    // Simulate a crashed cleanup: remove the worktree directory directly,
    // leaving the gitlink dangling under .git/worktrees/.
    await Deno.remove(worktreePath, { recursive: true });
    assertEquals(
      (await Deno.stat(`${gitlinkRoot}/${beforeEntries[0]}`)).isDirectory,
      true,
    );

    // removeWorktree should swallow the "not a working tree" error AND
    // call `git worktree prune` so the stale gitlink is gone afterwards.
    await removeWorktree(worktreePath);

    const gitlinkStillThere = await Deno.stat(
      `${gitlinkRoot}/${beforeEntries[0]}`,
    ).then(() => true, () => false);
    assertEquals(gitlinkStillThere, false);
  } finally {
    Deno.chdir(origCwd);
    await Deno.remove(tmpOrigin, { recursive: true });
    await Deno.remove(tmpClone, { recursive: true });
  }
});

Deno.test("createWorktree — fails on fetch error with bad remote", async () => {
  // Create a temporary bare git repo with no 'origin' remote
  const tmpDir = await Deno.makeTempDir();
  const origCwd = Deno.cwd();
  try {
    // Initialize a fresh repo with no remotes
    const init = new Deno.Command("git", {
      args: ["init", "--initial-branch=main"],
      cwd: tmpDir,
      stdout: "null",
      stderr: "null",
    });
    await init.output();

    // Configure git user for commits
    const configName = new Deno.Command("git", {
      args: ["config", "user.email", "test@test.com"],
      cwd: tmpDir,
      stdout: "null",
      stderr: "null",
    });
    await configName.output();
    const configEmail = new Deno.Command("git", {
      args: ["config", "user.name", "Test"],
      cwd: tmpDir,
      stdout: "null",
      stderr: "null",
    });
    await configEmail.output();

    // Create an initial commit
    await Deno.writeTextFile(`${tmpDir}/README.md`, "test");
    const add = new Deno.Command("git", {
      args: ["add", "."],
      cwd: tmpDir,
      stdout: "null",
      stderr: "null",
    });
    await add.output();
    const commit = new Deno.Command("git", {
      args: ["commit", "-m", "init"],
      cwd: tmpDir,
      stdout: "null",
      stderr: "null",
    });
    await commit.output();

    // Chdir to temp repo (createWorktree uses relative paths)
    Deno.chdir(tmpDir);

    // createWorktree should fail because there's no 'origin' remote
    let thrown = false;
    try {
      await createWorktree("test-run", ".flowai-workflow/example");
    } catch (e) {
      thrown = true;
      assertEquals(
        (e as Error).message.includes("git fetch origin main failed"),
        true,
      );
    }
    assertEquals(thrown, true);
  } finally {
    Deno.chdir(origCwd);
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("worktree lifecycle — create, exists, remove (FR-E57 layout)", async () => {
  const { tmpOrigin, tmpClone } = await setupOriginAndClone();
  const origCwd = Deno.cwd();
  try {
    Deno.chdir(tmpClone);

    const runId = "test-worktree-lifecycle";
    const workflowDir = ".flowai-workflow/example";

    // Before creation: doesn't exist
    assertEquals(worktreeExists(runId, workflowDir), false);

    // Create worktree
    const path = await createWorktree(runId, workflowDir);
    assertEquals(path, `${workflowDir}/runs/${runId}/worktree`);
    assertEquals(worktreeExists(runId, workflowDir), true);

    // Verify worktree has files from origin/main
    const readme = await Deno.readTextFile(`${path}/README.md`);
    assertEquals(readme, "test");

    // Remove worktree
    await removeWorktree(path);
    assertEquals(worktreeExists(runId, workflowDir), false);
  } finally {
    Deno.chdir(origCwd);
    await Deno.remove(tmpOrigin, { recursive: true });
    await Deno.remove(tmpClone, { recursive: true });
  }
});

Deno.test("createWorktree — distinct workflow dirs hold independent worktrees (FR-E57)", async () => {
  const { tmpOrigin, tmpClone } = await setupOriginAndClone();
  const origCwd = Deno.cwd();
  try {
    Deno.chdir(tmpClone);

    const runId = "shared-run-id";
    const wfA = ".flowai-workflow/wf-a";
    const wfB = ".flowai-workflow/wf-b";

    const pathA = await createWorktree(runId, wfA);
    const pathB = await createWorktree(runId, wfB);

    assertEquals(pathA, `${wfA}/runs/${runId}/worktree`);
    assertEquals(pathB, `${wfB}/runs/${runId}/worktree`);
    assertEquals(pathA === pathB, false);

    // Both exist independently.
    assertEquals(worktreeExists(runId, wfA), true);
    assertEquals(worktreeExists(runId, wfB), true);

    // Removing one leaves the other intact.
    await removeWorktree(pathA);
    assertEquals(worktreeExists(runId, wfA), false);
    assertEquals(worktreeExists(runId, wfB), true);

    await removeWorktree(pathB);
  } finally {
    Deno.chdir(origCwd);
    await Deno.remove(tmpOrigin, { recursive: true });
    await Deno.remove(tmpClone, { recursive: true });
  }
});

Deno.test("copyToOriginalRepo — copies file from workDir to CWD-relative path", async () => {
  const tmpDir = await Deno.makeTempDir();
  const origCwd = Deno.cwd();
  try {
    Deno.chdir(tmpDir);

    // Create a workDir with a file
    const workDir = `${tmpDir}/worktree`;
    await Deno.mkdir(`${workDir}/subdir`, { recursive: true });
    await Deno.writeTextFile(`${workDir}/subdir/state.json`, '{"test": true}');

    // Copy to "original repo" (CWD-relative)
    await copyToOriginalRepo(workDir, "subdir/state.json");

    // Verify the copy
    const content = await Deno.readTextFile(`${tmpDir}/subdir/state.json`);
    assertEquals(content, '{"test": true}');
  } finally {
    Deno.chdir(origCwd);
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// --- pinDetachedHead (FR-E51) ---

/** Set up a temp git repo with one initial commit on `main`. */
async function setupMiniRepo(): Promise<string> {
  const tmp = await Deno.makeTempDir();
  await runGitCmd(["init", "--initial-branch=main"], tmp);
  await runGitCmd(["config", "user.email", "test@test.com"], tmp);
  await runGitCmd(["config", "user.name", "Test"], tmp);
  await Deno.writeTextFile(`${tmp}/README.md`, "init\n");
  await runGitCmd(["add", "."], tmp);
  await runGitCmd(["commit", "-m", "init"], tmp);
  return tmp;
}

Deno.test("pinDetachedHead — creates rescue branch on detached HEAD", async () => {
  const repo = await setupMiniRepo();
  try {
    // Detach HEAD (without -b) — leaves main ref alone, HEAD = same commit.
    await runGitCmd(["checkout", "--detach", "HEAD"], repo);

    const name = await pinDetachedHead(repo, "20260426T120000");
    assertEquals(name, "flowai/run-20260426T120000-orphan-rescue");

    // Branch ref exists.
    const verify = await new Deno.Command("git", {
      args: [
        "-C",
        repo,
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/heads/${name}`,
      ],
      stdout: "null",
      stderr: "null",
    }).output();
    assertEquals(verify.success, true);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("pinDetachedHead — returns undefined when HEAD on named branch", async () => {
  const repo = await setupMiniRepo();
  try {
    // HEAD is on `main` after init — already named.
    const name = await pinDetachedHead(repo, "20260426T120000");
    assertEquals(name, undefined);

    // No rescue branch was created.
    const verify = await new Deno.Command("git", {
      args: [
        "-C",
        repo,
        "rev-parse",
        "--verify",
        "--quiet",
        "refs/heads/flowai/run-20260426T120000-orphan-rescue",
      ],
      stdout: "null",
      stderr: "null",
    }).output();
    assertEquals(verify.success, false);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("pinDetachedHead — appends counter when branch name already exists", async () => {
  const repo = await setupMiniRepo();
  try {
    await runGitCmd(["checkout", "--detach", "HEAD"], repo);

    const first = await pinDetachedHead(repo, "20260426T120000");
    assertEquals(first, "flowai/run-20260426T120000-orphan-rescue");

    // Re-detach (still at same commit) and re-invoke.
    await runGitCmd(["checkout", "--detach", "HEAD"], repo);
    const second = await pinDetachedHead(repo, "20260426T120000");
    assertEquals(second, "flowai/run-20260426T120000-orphan-rescue-2");

    await runGitCmd(["checkout", "--detach", "HEAD"], repo);
    const third = await pinDetachedHead(repo, "20260426T120000");
    assertEquals(third, "flowai/run-20260426T120000-orphan-rescue-3");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("pinDetachedHead — rescue branch points at detached HEAD commit", async () => {
  const repo = await setupMiniRepo();
  try {
    // Make an extra commit so HEAD is past `main`.
    await runGitCmd(["checkout", "--detach", "HEAD"], repo);
    await Deno.writeTextFile(`${repo}/extra.md`, "orphan\n");
    await runGitCmd(["add", "extra.md"], repo);
    await runGitCmd(["commit", "-m", "orphan-commit"], repo);

    // Capture HEAD sha
    const headSha = (await new Deno.Command("git", {
      args: ["-C", repo, "rev-parse", "HEAD"],
      stdout: "piped",
      stderr: "null",
    }).output().then((o) => new TextDecoder().decode(o.stdout))).trim();

    const name = await pinDetachedHead(repo, "RUN");
    assertEquals(name, "flowai/run-RUN-orphan-rescue");

    const branchSha = (await new Deno.Command("git", {
      args: ["-C", repo, "rev-parse", `refs/heads/${name}`],
      stdout: "piped",
      stderr: "null",
    }).output().then((o) => new TextDecoder().decode(o.stdout))).trim();

    assertEquals(branchSha, headSha);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

/** Helper to run a git command in a specific directory. */
async function runGitCmd(args: string[], cwd: string): Promise<void> {
  const cmd = new Deno.Command("git", {
    args,
    cwd,
    stdout: "null",
    stderr: "null",
  });
  const result = await cmd.output();
  if (!result.success) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}`);
  }
}

/** Set up a bare origin + working clone with one commit on `main`. */
async function setupOriginAndClone(): Promise<
  { tmpOrigin: string; tmpClone: string }
> {
  const tmpOrigin = await Deno.makeTempDir();
  const tmpClone = await Deno.makeTempDir();
  await runGitCmd(["init", "--bare", "--initial-branch=main"], tmpOrigin);

  const clone = new Deno.Command("git", {
    args: ["clone", tmpOrigin, tmpClone],
    stdout: "null",
    stderr: "null",
  });
  await clone.output();

  await runGitCmd(["config", "user.email", "test@test.com"], tmpClone);
  await runGitCmd(["config", "user.name", "Test"], tmpClone);
  await runGitCmd(["checkout", "-b", "main"], tmpClone);
  await Deno.writeTextFile(`${tmpClone}/README.md`, "test");
  await runGitCmd(["add", "."], tmpClone);
  await runGitCmd(["commit", "-m", "init"], tmpClone);
  await runGitCmd(["push", "-u", "origin", "main"], tmpClone);
  return { tmpOrigin, tmpClone };
}
