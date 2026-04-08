import { assertEquals } from "@std/assert";
import {
  copyToOriginalRepo,
  createWorktree,
  getWorktreePath,
  removeWorktree,
  worktreeExists,
} from "./worktree.ts";

Deno.test("getWorktreePath — returns expected path", () => {
  assertEquals(
    getWorktreePath("20260408T120000"),
    ".flowai-workflow/worktrees/20260408T120000",
  );
});

Deno.test("getWorktreePath — includes label in path", () => {
  assertEquals(
    getWorktreePath("20260408T120000-my-feature"),
    ".flowai-workflow/worktrees/20260408T120000-my-feature",
  );
});

Deno.test("worktreeExists — returns false for non-existent worktree", () => {
  assertEquals(worktreeExists("nonexistent-run-id-abc123"), false);
});

Deno.test("removeWorktree — swallows error for non-existent worktree", async () => {
  // Should not throw for a path that doesn't exist
  await removeWorktree("/tmp/nonexistent-worktree-abc123");
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
      await createWorktree("test-run");
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

Deno.test("worktree lifecycle — create, exists, remove", async () => {
  // Create a temporary repo with a local 'origin' to satisfy fetch
  const tmpOrigin = await Deno.makeTempDir();
  const tmpClone = await Deno.makeTempDir();
  const origCwd = Deno.cwd();

  try {
    // Set up origin repo
    await runGitCmd(["init", "--bare"], tmpOrigin);

    // Clone it to get a working repo with origin
    const clone = new Deno.Command("git", {
      args: ["clone", tmpOrigin, tmpClone],
      stdout: "null",
      stderr: "null",
    });
    await clone.output();

    // Configure and create initial commit
    await runGitCmd(["config", "user.email", "test@test.com"], tmpClone);
    await runGitCmd(["config", "user.name", "Test"], tmpClone);
    await Deno.writeTextFile(`${tmpClone}/README.md`, "test");
    await runGitCmd(["add", "."], tmpClone);
    await runGitCmd(["commit", "-m", "init"], tmpClone);
    await runGitCmd(["push", "origin", "main"], tmpClone);

    // Create worktrees directory
    await Deno.mkdir(`${tmpClone}/.flowai-workflow/worktrees`, {
      recursive: true,
    });

    // Change to clone dir
    Deno.chdir(tmpClone);

    const runId = "test-worktree-lifecycle";

    // Before creation: doesn't exist
    assertEquals(worktreeExists(runId), false);

    // Create worktree
    const path = await createWorktree(runId);
    assertEquals(path, `.flowai-workflow/worktrees/${runId}`);
    assertEquals(worktreeExists(runId), true);

    // Verify worktree has files from origin/main
    const readme = await Deno.readTextFile(`${path}/README.md`);
    assertEquals(readme, "test");

    // Remove worktree
    await removeWorktree(path);
    assertEquals(worktreeExists(runId), false);
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
