/**
 * @module
 * Tests for FR-E58 — `copyIgnoredIntoWorktree`. Validates that gitignored
 * files in the original repo are mirrored into the run worktree, with
 * progress logged via OutputManager.
 */

import { assertEquals } from "@std/assert";
import { copyIgnoredIntoWorktree } from "./worktree.ts";
import { OutputManager } from "./output.ts";

interface CapturedOutput {
  output: OutputManager;
  buffer: string[];
}

function makeCapturedOutput(): CapturedOutput {
  const buffer: string[] = [];
  const output = new OutputManager("normal", (text) => {
    buffer.push(text);
  });
  return { output, buffer };
}

/** Run a git command in `cwd`, throw on failure. */
async function git(args: string[], cwd: string): Promise<void> {
  const result = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!result.success) {
    const err = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${err}`);
  }
}

/** Init a git repo with one tracked README and configured user. */
async function initRepo(): Promise<{ origRepo: string; destDir: string }> {
  const origRepo = await Deno.makeTempDir();
  const destDir = await Deno.makeTempDir();
  await git(["init", "--initial-branch=main"], origRepo);
  await git(["config", "user.email", "test@test.com"], origRepo);
  await git(["config", "user.name", "Test"], origRepo);
  await Deno.writeTextFile(`${origRepo}/README.md`, "tracked\n");
  return { origRepo, destDir };
}

async function cleanup(...dirs: string[]): Promise<void> {
  for (const d of dirs) {
    try {
      await Deno.remove(d, { recursive: true });
    } catch { /* ignore */ }
  }
}

Deno.test("copyIgnoredIntoWorktree — copies a single ignored file", async () => {
  const { origRepo, destDir } = await initRepo();
  try {
    await Deno.writeTextFile(`${origRepo}/.gitignore`, ".env\n");
    await Deno.writeTextFile(`${origRepo}/.env`, "secret");
    await git(["add", ".gitignore", "README.md"], origRepo);
    await git(["commit", "-m", "init"], origRepo);

    const { output } = makeCapturedOutput();
    const result = await copyIgnoredIntoWorktree(destDir, output, origRepo);

    const copied = await Deno.readTextFile(`${destDir}/.env`);
    assertEquals(copied, "secret");
    assertEquals(result.files, 1);
    assertEquals(result.bytes, 6);
  } finally {
    await cleanup(origRepo, destDir);
  }
});

Deno.test("copyIgnoredIntoWorktree — recurses into ignored directory", async () => {
  const { origRepo, destDir } = await initRepo();
  try {
    await Deno.writeTextFile(`${origRepo}/.gitignore`, "node_modules/\n");
    await Deno.mkdir(`${origRepo}/node_modules/foo`, { recursive: true });
    await Deno.writeTextFile(`${origRepo}/node_modules/foo/bar.txt`, "AB");
    await Deno.writeTextFile(`${origRepo}/node_modules/baz.txt`, "CDE");
    await git(["add", ".gitignore", "README.md"], origRepo);
    await git(["commit", "-m", "init"], origRepo);

    const { output } = makeCapturedOutput();
    const result = await copyIgnoredIntoWorktree(destDir, output, origRepo);

    const bar = await Deno.readTextFile(`${destDir}/node_modules/foo/bar.txt`);
    const baz = await Deno.readTextFile(`${destDir}/node_modules/baz.txt`);
    assertEquals(bar, "AB");
    assertEquals(baz, "CDE");
    assertEquals(result.files, 2);
    assertEquals(result.bytes, 5);
  } finally {
    await cleanup(origRepo, destDir);
  }
});

Deno.test("copyIgnoredIntoWorktree — preserves symlinks (live target)", async () => {
  const { origRepo, destDir } = await initRepo();
  try {
    await Deno.writeTextFile(`${origRepo}/.gitignore`, "links/\n");
    await Deno.mkdir(`${origRepo}/links`);
    await Deno.writeTextFile(`${origRepo}/links/target.txt`, "T");
    await Deno.symlink("target.txt", `${origRepo}/links/sym`);
    await git(["add", ".gitignore", "README.md"], origRepo);
    await git(["commit", "-m", "init"], origRepo);

    const { output } = makeCapturedOutput();
    await copyIgnoredIntoWorktree(destDir, output, origRepo);

    const lst = await Deno.lstat(`${destDir}/links/sym`);
    assertEquals(lst.isSymlink, true);
    const target = await Deno.readLink(`${destDir}/links/sym`);
    assertEquals(target, "target.txt");
  } finally {
    await cleanup(origRepo, destDir);
  }
});

Deno.test("copyIgnoredIntoWorktree — preserves broken symlinks", async () => {
  const { origRepo, destDir } = await initRepo();
  try {
    await Deno.writeTextFile(`${origRepo}/.gitignore`, "links/\n");
    await Deno.mkdir(`${origRepo}/links`);
    await Deno.symlink("does-not-exist", `${origRepo}/links/broken`);
    await git(["add", ".gitignore", "README.md"], origRepo);
    await git(["commit", "-m", "init"], origRepo);

    const { output } = makeCapturedOutput();
    await copyIgnoredIntoWorktree(destDir, output, origRepo);

    const lst = await Deno.lstat(`${destDir}/links/broken`);
    assertEquals(lst.isSymlink, true);
    const target = await Deno.readLink(`${destDir}/links/broken`);
    assertEquals(target, "does-not-exist");
  } finally {
    await cleanup(origRepo, destDir);
  }
});

Deno.test("copyIgnoredIntoWorktree — does NOT copy untracked-not-ignored files", async () => {
  const { origRepo, destDir } = await initRepo();
  try {
    await Deno.writeTextFile(`${origRepo}/.gitignore`, ".env\n");
    await Deno.writeTextFile(`${origRepo}/scratch.txt`, "wip");
    await git(["add", ".gitignore", "README.md"], origRepo);
    await git(["commit", "-m", "init"], origRepo);

    const { output } = makeCapturedOutput();
    const result = await copyIgnoredIntoWorktree(destDir, output, origRepo);

    let scratchExists = true;
    try {
      await Deno.lstat(`${destDir}/scratch.txt`);
    } catch {
      scratchExists = false;
    }
    assertEquals(scratchExists, false);
    assertEquals(result.files, 0);
    assertEquals(result.bytes, 0);
  } finally {
    await cleanup(origRepo, destDir);
  }
});

Deno.test("copyIgnoredIntoWorktree — does NOT touch tracked files in destination", async () => {
  const { origRepo, destDir } = await initRepo();
  try {
    await Deno.writeTextFile(`${origRepo}/.gitignore`, ".env\n");
    await Deno.writeTextFile(`${origRepo}/.env`, "secret");
    await git(["add", ".gitignore", "README.md"], origRepo);
    await git(["commit", "-m", "init"], origRepo);

    // Pre-populate destDir with a different README — simulates worktree
    // checkout already containing the tracked file.
    await Deno.writeTextFile(`${destDir}/README.md`, "different");

    const { output } = makeCapturedOutput();
    await copyIgnoredIntoWorktree(destDir, output, origRepo);

    // README.md is tracked → not in ignored list → unchanged in destDir.
    const readme = await Deno.readTextFile(`${destDir}/README.md`);
    assertEquals(readme, "different");
  } finally {
    await cleanup(origRepo, destDir);
  }
});

Deno.test("copyIgnoredIntoWorktree — emits start, per-entry, and final progress lines", async () => {
  const { origRepo, destDir } = await initRepo();
  try {
    await Deno.writeTextFile(`${origRepo}/.gitignore`, ".env\nnode_modules/\n");
    await Deno.writeTextFile(`${origRepo}/.env`, "x");
    await Deno.mkdir(`${origRepo}/node_modules`);
    await Deno.writeTextFile(`${origRepo}/node_modules/dep.js`, "yy");
    await git(["add", ".gitignore", "README.md"], origRepo);
    await git(["commit", "-m", "init"], origRepo);

    const { output, buffer } = makeCapturedOutput();
    await copyIgnoredIntoWorktree(destDir, output, origRepo);

    const joined = buffer.join("");
    assertEquals(joined.includes("Copying ignored files..."), true);
    assertEquals(joined.includes("Copied .env: 1 files"), true);
    assertEquals(joined.includes("Copied node_modules: 1 files"), true);
    assertEquals(joined.includes("Ignored files copied: 2 files"), true);
  } finally {
    await cleanup(origRepo, destDir);
  }
});

Deno.test("copyIgnoredIntoWorktree — does not recurse into workDir (legacy single-worktree guard, no workflowDir)", async () => {
  // Legacy guard: when `workflowDir` is omitted, only the destination
  // worktree itself is protected from self-copy. Mirrors callers that
  // don't model the engine runs/ layout.
  const origRepo = await Deno.makeTempDir();
  try {
    await git(["init", "--initial-branch=main"], origRepo);
    await git(["config", "user.email", "test@test.com"], origRepo);
    await git(["config", "user.name", "Test"], origRepo);
    await Deno.writeTextFile(`${origRepo}/.gitignore`, "runs/\n");
    await Deno.writeTextFile(`${origRepo}/README.md`, "tracked\n");
    await git(["add", ".gitignore", "README.md"], origRepo);
    await git(["commit", "-m", "init"], origRepo);

    const workDir = `${origRepo}/runs/new/worktree`;
    await Deno.mkdir(workDir, { recursive: true });

    const { output } = makeCapturedOutput();
    await copyIgnoredIntoWorktree(workDir, output, origRepo);

    let selfCopied = true;
    try {
      await Deno.lstat(`${workDir}/runs/new/worktree`);
    } catch {
      selfCopied = false;
    }
    assertEquals(selfCopied, false);
  } finally {
    await cleanup(origRepo);
  }
});

Deno.test("copyIgnoredIntoWorktree — excludes entire <workflowDir>/runs/ subtree when workflowDir is supplied", async () => {
  // Multi-worktree exponential-nesting bug. With workflowDir supplied,
  // the engine's runs/ root is wholly skipped: no sibling worktrees,
  // no foreign state.json, no foreign per-node artefacts leak into the
  // freshly-created worktree. Ignored paths OUTSIDE that root (e.g.
  // top-level .env) must still mirror normally.
  const origRepo = await Deno.makeTempDir();
  try {
    await git(["init", "--initial-branch=main"], origRepo);
    await git(["config", "user.email", "test@test.com"], origRepo);
    await git(["config", "user.name", "Test"], origRepo);
    await Deno.writeTextFile(
      `${origRepo}/.gitignore`,
      ".flowai-workflow/wf/runs/\n.env\n",
    );
    await Deno.writeTextFile(`${origRepo}/README.md`, "tracked\n");
    await Deno.writeTextFile(`${origRepo}/.env`, "secret");
    await git(["add", ".gitignore", "README.md"], origRepo);
    await git(["commit", "-m", "init"], origRepo);

    const workflowDir = `${origRepo}/.flowai-workflow/wf`;

    // Two prior runs: a "live" one with its own deeply-nested mirror
    // (worst-case shape) and a stale one with only state.json.
    const liveOldRoot = `${workflowDir}/runs/T_old/worktree`;
    await Deno.mkdir(`${liveOldRoot}/.flowai-workflow/wf/runs/T_older`, {
      recursive: true,
    });
    await Deno.writeTextFile(`${liveOldRoot}/foo.txt`, "x");
    await Deno.writeTextFile(
      `${liveOldRoot}/.flowai-workflow/wf/runs/T_older/state.json`,
      "{}",
    );
    await Deno.writeTextFile(`${workflowDir}/runs/T_old/state.json`, "{}");
    await Deno.mkdir(`${workflowDir}/runs/T_stale`, { recursive: true });
    await Deno.writeTextFile(
      `${workflowDir}/runs/T_stale/state.json`,
      "{}",
    );

    // Fresh worktree for the new run.
    const workDir = `${workflowDir}/runs/T_new/worktree`;
    await Deno.mkdir(workDir, { recursive: true });

    const { output } = makeCapturedOutput();
    await copyIgnoredIntoWorktree(workDir, output, origRepo, workflowDir);

    // Nothing from the engine runs/ root should appear under workDir.
    let runsMirrored = true;
    try {
      await Deno.lstat(`${workDir}/.flowai-workflow/wf/runs`);
    } catch {
      runsMirrored = false;
    }
    assertEquals(runsMirrored, false);

    // No nested worktree dir at any depth.
    const nested = await collectPathsByName(workDir, "worktree");
    assertEquals(nested.length, 0);

    // Out-of-runs ignored file is still mirrored.
    const env = await Deno.readTextFile(`${workDir}/.env`);
    assertEquals(env, "secret");
  } finally {
    await cleanup(origRepo);
  }
});

/** Recursively collect paths under `root` whose basename equals `name`. */
async function collectPathsByName(
  root: string,
  name: string,
): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: AsyncIterable<Deno.DirEntry>;
    try {
      entries = Deno.readDir(dir);
    } catch {
      return;
    }
    for await (const entry of entries) {
      const full = `${dir}/${entry.name}`;
      if (entry.name === name) out.push(full);
      if (entry.isDirectory) await walk(full);
    }
  }
  await walk(root);
  return out;
}

Deno.test("copyIgnoredIntoWorktree — empty repo with no ignored files returns zero counters", async () => {
  const { origRepo, destDir } = await initRepo();
  try {
    await git(["add", "README.md"], origRepo);
    await git(["commit", "-m", "init"], origRepo);

    const { output } = makeCapturedOutput();
    const result = await copyIgnoredIntoWorktree(destDir, output, origRepo);

    assertEquals(result.files, 0);
    assertEquals(result.bytes, 0);
  } finally {
    await cleanup(origRepo, destDir);
  }
});
