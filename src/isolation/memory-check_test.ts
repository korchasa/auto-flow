import { assertEquals } from "@std/assert";
import { findDirtyMemoryFiles, formatMemoryViolation } from "./memory-check.ts";

async function git(cwd: string, ...args: string[]): Promise<void> {
  const out = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!out.success) {
    const stderr = new TextDecoder().decode(out.stderr);
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
}

async function setupRepo(): Promise<string> {
  const repo = await Deno.makeTempDir();
  await git(repo, "init", "--initial-branch=main");
  await git(repo, "config", "user.email", "test@test.com");
  await git(repo, "config", "user.name", "Test");
  await Deno.mkdir(`${repo}/.flowai-workflow/memory`, { recursive: true });
  await Deno.writeTextFile(
    `${repo}/.flowai-workflow/memory/agent-pm.md`,
    "initial\n",
  );
  await Deno.writeTextFile(`${repo}/README.md`, "init\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "init");
  return repo;
}

Deno.test("findDirtyMemoryFiles — empty memory_paths returns empty", async () => {
  const repo = await setupRepo();
  try {
    await Deno.writeTextFile(
      `${repo}/.flowai-workflow/memory/agent-pm.md`,
      "dirty\n",
    );
    assertEquals(await findDirtyMemoryFiles(repo, []), []);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("findDirtyMemoryFiles — clean repo returns empty", async () => {
  const repo = await setupRepo();
  try {
    const dirty = await findDirtyMemoryFiles(repo, [
      ".flowai-workflow/memory/**.md",
    ]);
    assertEquals(dirty, []);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("findDirtyMemoryFiles — modified memory file detected", async () => {
  const repo = await setupRepo();
  try {
    await Deno.writeTextFile(
      `${repo}/.flowai-workflow/memory/agent-pm.md`,
      "modified\n",
    );
    const dirty = await findDirtyMemoryFiles(repo, [
      ".flowai-workflow/memory/**.md",
    ]);
    assertEquals(dirty, [".flowai-workflow/memory/agent-pm.md"]);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("findDirtyMemoryFiles — new untracked memory file detected", async () => {
  const repo = await setupRepo();
  try {
    await Deno.writeTextFile(
      `${repo}/.flowai-workflow/memory/agent-pm-history.md`,
      "new\n",
    );
    const dirty = await findDirtyMemoryFiles(repo, [
      ".flowai-workflow/memory/**.md",
    ]);
    assertEquals(dirty, [".flowai-workflow/memory/agent-pm-history.md"]);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("findDirtyMemoryFiles — non-memory dirty paths ignored", async () => {
  const repo = await setupRepo();
  try {
    await Deno.writeTextFile(`${repo}/README.md`, "modified\n");
    await Deno.writeTextFile(
      `${repo}/.flowai-workflow/memory/agent-pm.md`,
      "dirty\n",
    );
    const dirty = await findDirtyMemoryFiles(repo, [
      ".flowai-workflow/memory/**.md",
    ]);
    assertEquals(dirty, [".flowai-workflow/memory/agent-pm.md"]);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("findDirtyMemoryFiles — multiple memory files all returned", async () => {
  const repo = await setupRepo();
  try {
    await Deno.writeTextFile(
      `${repo}/.flowai-workflow/memory/agent-pm.md`,
      "1\n",
    );
    await Deno.writeTextFile(
      `${repo}/.flowai-workflow/memory/agent-qa.md`,
      "2\n",
    );
    const dirty = await findDirtyMemoryFiles(repo, [
      ".flowai-workflow/memory/**.md",
    ]);
    assertEquals(dirty.sort(), [
      ".flowai-workflow/memory/agent-pm.md",
      ".flowai-workflow/memory/agent-qa.md",
    ]);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("findDirtyMemoryFiles — committed memory file is clean (no leak)", async () => {
  const repo = await setupRepo();
  try {
    await Deno.writeTextFile(
      `${repo}/.flowai-workflow/memory/agent-pm.md`,
      "updated\n",
    );
    await git(repo, "add", ".flowai-workflow/memory/agent-pm.md");
    await git(repo, "commit", "-m", "chore(memory): update");
    const dirty = await findDirtyMemoryFiles(repo, [
      ".flowai-workflow/memory/**.md",
    ]);
    assertEquals(dirty, []);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("formatMemoryViolation — single file", () => {
  const msg = formatMemoryViolation("build", [
    ".flowai-workflow/memory/agent-developer.md",
  ]);
  assertEquals(
    msg,
    "[memory-check] node=build left 1 memory file(s) uncommitted: " +
      ".flowai-workflow/memory/agent-developer.md. " +
      "Commit them or set 'memory_commit_deferred: true' on this node.",
  );
});

Deno.test("formatMemoryViolation — multiple files", () => {
  const msg = formatMemoryViolation("verify", [
    ".flowai-workflow/memory/agent-qa.md",
    ".flowai-workflow/memory/agent-qa-history.md",
  ]);
  assertEquals(msg.includes("node=verify"), true);
  assertEquals(msg.includes("2 memory file(s)"), true);
  assertEquals(msg.includes("agent-qa.md"), true);
  assertEquals(msg.includes("agent-qa-history.md"), true);
});
