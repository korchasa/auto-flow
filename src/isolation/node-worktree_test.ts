import { assertEquals, assertThrows } from "@std/assert";
import {
  createNodeWorktree,
  getNodeWorktreePath,
  removeWorktree,
  resolveTreeHead,
  worktreeKey,
} from "./worktree.ts";

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

async function setupRepo(): Promise<string> {
  const repo = await Deno.makeTempDir();
  await git(repo, "init", "--initial-branch=main");
  await git(repo, "config", "user.email", "test@test.com");
  await git(repo, "config", "user.name", "Test");
  await Deno.writeTextFile(`${repo}/src.txt`, "base\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "init");
  return repo;
}

Deno.test("FR-E91 getNodeWorktreePath sits beside the run's own worktree", () => {
  assertEquals(
    getNodeWorktreePath("R1", ".flowai-workflow/wf", "build"),
    ".flowai-workflow/wf/runs/R1/worktrees/build",
  );
});

Deno.test("FR-E91 worktreeKey joins a node and a fan-out item", () => {
  assertEquals(worktreeKey("build"), "build");
  assertEquals(worktreeKey("build", "2"), "build-2");
});

Deno.test("FR-E91 worktreeKey strips path separators so a key cannot escape", () => {
  assertEquals(worktreeKey("../../etc", "a/b"), "..-..-etc-a-b");
});

Deno.test("FR-E91 worktreeKey rejects a key that slugifies to nothing", () => {
  assertThrows(() => worktreeKey(""), Error, "cannot be empty");
});

Deno.test("FR-E91 createNodeWorktree checks out the node's own tree at the given ref", async () => {
  const repo = await setupRepo();
  const origCwd = Deno.cwd();
  try {
    Deno.chdir(repo);
    const head = await resolveTreeHead(".");
    const path = await createNodeWorktree("R1", "wf", "build", head);

    assertEquals(path, "wf/runs/R1/worktrees/build");
    assertEquals(await Deno.readTextFile(`${repo}/${path}/src.txt`), "base\n");

    // An edit inside the node's tree does not reach the main tree.
    await Deno.writeTextFile(`${repo}/${path}/src.txt`, "edited\n");
    assertEquals(await Deno.readTextFile(`${repo}/src.txt`), "base\n");

    await removeWorktree(path);
    assertEquals(await pathExists(`${repo}/${path}`), false);
  } finally {
    Deno.chdir(origCwd);
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("FR-E91 resolveTreeHead reports the commit the tree is checked out at", async () => {
  const repo = await setupRepo();
  const origCwd = Deno.cwd();
  try {
    Deno.chdir(repo);
    const head = await resolveTreeHead(".");
    assertEquals(/^[0-9a-f]{40}$/.test(head), true);
  } finally {
    Deno.chdir(origCwd);
    await Deno.remove(repo, { recursive: true });
  }
});

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
