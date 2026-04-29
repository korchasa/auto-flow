import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { runPreflight, summarizeFailures } from "./preflight.ts";

// ---------------------------------------------------------------------------
// summarizeFailures — rendering helper.
// ---------------------------------------------------------------------------

Deno.test("summarizeFailures — joins error messages as a bullet list", () => {
  const msg = summarizeFailures([
    "not a git repo",
    "tree dirty",
  ]);
  if (!msg.includes("not a git repo")) {
    throw new Error(`summary missing first failure: ${msg}`);
  }
  if (!msg.includes("tree dirty")) {
    throw new Error(`summary missing second failure: ${msg}`);
  }
});

Deno.test("summarizeFailures — empty list returns empty string", () => {
  assertEquals(summarizeFailures([]), "");
});

// ---------------------------------------------------------------------------
// runPreflight — integration tests against a real tmp git repo. Requires
// `git`; skip if not available.
// ---------------------------------------------------------------------------

async function haveBinary(name: string): Promise<boolean> {
  try {
    const { success } = await new Deno.Command(name, {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).output();
    return success;
  } catch {
    return false;
  }
}

async function initGitRepo(root: string): Promise<void> {
  const cmds = [
    ["init", "-q"],
    ["config", "user.email", "test@example.com"],
    ["config", "user.name", "test"],
  ];
  for (const args of cmds) {
    const { success, stderr } = await new Deno.Command("git", {
      args,
      cwd: root,
      stdout: "null",
      stderr: "piped",
    }).output();
    if (!success) {
      throw new Error(
        `git ${args.join(" ")}: ${new TextDecoder().decode(stderr)}`,
      );
    }
  }
}

Deno.test("runPreflight — clean git repo passes base check", async () => {
  if (!await haveBinary("git")) return;
  const root = await Deno.makeTempDir();
  try {
    await initGitRepo(root);
    const result = await runPreflight({
      cwd: root,
      allowDirty: true,
      targetDir: join(root, ".flowai-workflow", "x"),
    });
    assertEquals(result.failures, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("runPreflight — fails when target workflow dir already exists", async () => {
  if (!await haveBinary("git")) return;
  const root = await Deno.makeTempDir();
  try {
    await initGitRepo(root);
    const target = join(root, ".flowai-workflow", "x");
    await Deno.mkdir(target, { recursive: true });
    const result = await runPreflight({
      cwd: root,
      allowDirty: true,
      targetDir: target,
    });
    const joined = result.failures.join("\n");
    if (!joined.includes("already exists")) {
      throw new Error(`expected 'already exists' in: ${joined}`);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("runPreflight — fails when cwd is not a git repo", async () => {
  if (!await haveBinary("git")) return;
  const root = await Deno.makeTempDir();
  try {
    const result = await runPreflight({
      cwd: root,
      allowDirty: true,
      targetDir: join(root, ".flowai-workflow", "x"),
    });
    const joined = result.failures.join("\n");
    if (!joined.toLowerCase().includes("git repo")) {
      throw new Error(`expected 'git repo' in failures: ${joined}`);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("runPreflight — dirty tree fails without --allow-dirty", async () => {
  if (!await haveBinary("git")) return;
  const root = await Deno.makeTempDir();
  try {
    await initGitRepo(root);
    await Deno.writeTextFile(join(root, "untracked.txt"), "x");
    const result = await runPreflight({
      cwd: root,
      allowDirty: false,
      targetDir: join(root, ".flowai-workflow", "x"),
    });
    const joined = result.failures.join("\n");
    if (!joined.includes("uncommitted")) {
      throw new Error(`expected 'uncommitted' in failures: ${joined}`);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
