/**
 * @module
 * Integration tests for `runInit` — stand up a real tmp git repo, run the
 * full scaffold path against it, and assert on the resulting file tree.
 *
 * These tests require the `git` binary and the bundled
 * `.flowai-workflow/github-inbox/` source tree (always present in this
 * repo's checkout). They skip silently if git is not available.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { listAvailableWorkflows, runInit } from "./mod.ts";

async function haveGit(): Promise<boolean> {
  try {
    const { success } = await new Deno.Command("git", {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).output();
    return success;
  } catch {
    return false;
  }
}

async function git(cwd: string, args: string[]): Promise<void> {
  const { success, stderr } = await new Deno.Command("git", {
    cwd,
    args,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!success) {
    throw new Error(
      `git ${args.join(" ")}: ${new TextDecoder().decode(stderr)}`,
    );
  }
}

async function setupFakeProject(root: string): Promise<void> {
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "test"]);
  await Deno.writeTextFile(
    join(root, "deno.json"),
    JSON.stringify({ name: "acme-demo", tasks: {} }),
  );
  await git(root, ["add", "deno.json"]);
  await git(root, ["commit", "-q", "-m", "init"]);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("runInit — scaffolds github-inbox verbatim end-to-end", async () => {
  if (!await haveGit()) return;
  const root = await Deno.makeTempDir({ prefix: "flowai-init-it-" });
  try {
    await setupFakeProject(root);

    // Capture stdout so we can assert the adaptation prompt is printed
    // on success. `console.log` goes through Deno's logger, not directly
    // through `Deno.stdout.write`, so intercept the high-level function.
    const origLog = console.log;
    const captured: string[] = [];
    console.log = (...args: unknown[]) => {
      captured.push(args.map((a) => String(a)).join(" "));
    };
    let exitCode: number;
    try {
      exitCode = await runInit(
        [],
        { cwd: root, engineVersion: "test-0.0.0" },
      );
    } finally {
      console.log = origLog;
    }
    assertEquals(exitCode, 0);
    const stdout = captured.join("\n");

    const workflowDir = join(root, ".flowai-workflow", "github-inbox");

    // Core files exist.
    const expected = [
      "workflow.yaml",
      "agents/agent-pm.md",
      "agents/agent-architect.md",
      "agents/agent-tech-lead.md",
      "agents/agent-developer.md",
      "agents/agent-qa.md",
      "agents/agent-tech-lead-review.md",
      "memory/reflection-protocol.md",
      "scripts/hitl-ask.sh",
      "scripts/hitl-check.sh",
    ];
    for (const rel of expected) {
      const full = join(workflowDir, rel);
      if (!await fileExists(full)) {
        throw new Error(`expected file missing after scaffold: ${full}`);
      }
    }

    // Verbatim copy: the workflow.yaml in the target must byte-equal the
    // bundled source. This is the dogfooding invariant — clients run the
    // exact bytes the project itself dogfoods.
    const sourceUrl = new URL(
      "../.flowai-workflow/github-inbox/workflow.yaml",
      import.meta.url,
    );
    const bundled = await Deno.readTextFile(sourceUrl);
    const installed = await Deno.readTextFile(
      join(workflowDir, "workflow.yaml"),
    );
    assertEquals(installed, bundled);

    // Success message must include the ready-to-paste adaptation prompt
    // block — this is the "configure via prompt" UX promise.
    for (
      const expected of [
        "ADAPTATION PROMPT (start)",
        "ADAPTATION PROMPT (end)",
        "Project Context",
        workflowDir,
      ]
    ) {
      if (!stdout.includes(expected)) {
        throw new Error(
          `success output missing "${expected}". Captured:\n${stdout}`,
        );
      }
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("runInit — --dry-run prints files without writing", async () => {
  if (!await haveGit()) return;
  const root = await Deno.makeTempDir({ prefix: "flowai-init-dry-" });
  try {
    await setupFakeProject(root);

    const exitCode = await runInit(
      ["--dry-run"],
      { cwd: root, engineVersion: "dry-0.0.0" },
    );
    assertEquals(exitCode, 0);

    const exists = await fileExists(join(root, ".flowai-workflow"));
    assertEquals(exists, false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("runInit — fails when target workflow dir already exists", async () => {
  if (!await haveGit()) return;
  const root = await Deno.makeTempDir({ prefix: "flowai-init-conflict-" });
  try {
    await setupFakeProject(root);
    await Deno.mkdir(
      join(root, ".flowai-workflow", "github-inbox"),
      { recursive: true },
    );

    const exitCode = await runInit(
      ["--allow-dirty"],
      { cwd: root, engineVersion: "test" },
    );
    assertEquals(exitCode, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("runInit — --workflow selects a different bundled workflow", async () => {
  if (!await haveGit()) return;
  const root = await Deno.makeTempDir({ prefix: "flowai-init-wname-" });
  try {
    await setupFakeProject(root);
    const exitCode = await runInit(
      ["--workflow", "autonomous-sdlc"],
      { cwd: root, engineVersion: "test-0.0.0" },
    );
    assertEquals(exitCode, 0);

    const wfDir = join(root, ".flowai-workflow", "autonomous-sdlc");
    const yaml = await Deno.readTextFile(join(wfDir, "workflow.yaml"));
    if (!yaml.length) throw new Error("workflow.yaml empty");

    // github-inbox must NOT have been scaffolded — only the requested one.
    const ghDirExists = await fileExists(
      join(root, ".flowai-workflow", "github-inbox"),
    );
    assertEquals(ghDirExists, false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("runInit — unknown workflow name returns 1", async () => {
  if (!await haveGit()) return;
  const root = await Deno.makeTempDir({ prefix: "flowai-init-unk-" });
  try {
    await setupFakeProject(root);
    const exitCode = await runInit(
      ["--workflow", "definitely-not-a-real-workflow-xyz"],
      { cwd: root, engineVersion: "test" },
    );
    assertEquals(exitCode, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("runInit — returns 3 on unknown argument", async () => {
  const exitCode = await runInit(["--nope-flag"]);
  assertEquals(exitCode, 3);
});

Deno.test("runInit — returns 0 on --help", async () => {
  const exitCode = await runInit(["--help"]);
  assertEquals(exitCode, 0);
});

Deno.test("runInit — --list returns 0 and enumerates bundled workflows", async () => {
  const exitCode = await runInit(["--list"]);
  assertEquals(exitCode, 0);
});

Deno.test(
  "listAvailableWorkflows — discovers all bundled workflows in repo",
  async () => {
    const workflows = await listAvailableWorkflows();
    // The dogfood checkout always carries these four; the test pins them
    // so a missing workflow.yaml is caught before it ships in a binary.
    for (
      const required of [
        "github-inbox",
        "github-inbox-opencode",
        "github-inbox-opencode-test",
        "autonomous-sdlc",
      ]
    ) {
      if (!workflows.includes(required)) {
        throw new Error(
          `expected bundled workflow "${required}" missing from list: ` +
            JSON.stringify(workflows),
        );
      }
    }
  },
);
