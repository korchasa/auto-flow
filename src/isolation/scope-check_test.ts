// FR-E37: scope-based file modification detection (allowed_paths).
import { Engine } from "../engine/engine.ts";
import { createFakeRuntime } from "../testing/fake-runtime.ts";
import { assertEquals } from "@std/assert";
import { findViolations, snapshotModifiedFiles } from "./scope-check.ts";

// --- findViolations pure function tests ---

Deno.test("findViolations — no violations: new mod matches allowed glob", () => {
  const before = new Set<string>();
  const after = new Set(["engine/agent.ts"]);
  assertEquals(findViolations(before, after, ["engine/**"]), []);
});

Deno.test("findViolations — violation detected: new mod not in allowed paths", () => {
  const before = new Set<string>();
  const after = new Set(["documents/design.md"]);
  assertEquals(findViolations(before, after, ["engine/**"]), [
    "documents/design.md",
  ]);
});

Deno.test("findViolations — pre-existing mods excluded from violations", () => {
  const before = new Set(["docs/readme.md"]);
  // docs/readme.md is pre-existing (in before), engine/agent.ts is new but allowed
  const after = new Set(["docs/readme.md", "engine/agent.ts"]);
  assertEquals(findViolations(before, after, ["engine/**"]), []);
});

Deno.test("findViolations — empty sets: no violations", () => {
  assertEquals(findViolations(new Set(), new Set(), ["engine/**"]), []);
});

Deno.test("findViolations — empty allowed paths: all new mods are violations", () => {
  const before = new Set<string>();
  const after = new Set(["engine/agent.ts"]);
  assertEquals(findViolations(before, after, []), ["engine/agent.ts"]);
});

Deno.test("findViolations — glob: * matches within single segment only", () => {
  const before = new Set<string>();
  const after = new Set(["engine/agent.ts", "engine/types.ts"]);
  assertEquals(findViolations(before, after, ["engine/*.ts"]), []);
});

Deno.test("findViolations — glob: * does not match across path separator", () => {
  const before = new Set<string>();
  const after = new Set(["engine/sub/agent.ts"]);
  // engine/*.ts should NOT match engine/sub/agent.ts
  assertEquals(findViolations(before, after, ["engine/*.ts"]), [
    "engine/sub/agent.ts",
  ]);
});

Deno.test("findViolations — glob: ** matches multiple path segments", () => {
  const before = new Set<string>();
  const after = new Set(["engine/sub/agent.ts", "engine/deep/sub/file.ts"]);
  assertEquals(findViolations(before, after, ["engine/**"]), []);
});

Deno.test("findViolations — multiple allowed paths: match against any", () => {
  const before = new Set<string>();
  const after = new Set(["engine/agent.ts", "engine/scope-check_test.ts"]);
  assertEquals(
    findViolations(before, after, ["engine/*.ts", "engine/*_test.ts"]),
    [],
  );
});

Deno.test("findViolations — multiple violations: all returned", () => {
  const before = new Set<string>();
  const after = new Set([
    "engine/agent.ts",
    ".github/workflow.yaml",
    ".flowai-workflow/scripts/foo.sh",
  ]);
  const violations = findViolations(before, after, ["engine/**"]);
  assertEquals(violations.length, 2);
  assertEquals(violations.includes(".github/workflow.yaml"), true);
  assertEquals(violations.includes(".flowai-workflow/scripts/foo.sh"), true);
  assertEquals(violations.includes("engine/agent.ts"), false);
});

Deno.test("findViolations — exact path match", () => {
  const before = new Set<string>();
  const after = new Set(["engine/agent.ts"]);
  assertEquals(findViolations(before, after, ["engine/agent.ts"]), []);
});

// --- snapshotModifiedFiles integration test ---

Deno.test("snapshotModifiedFiles — returns a Set of strings", async () => {
  const snapshot = await snapshotModifiedFiles();
  assertEquals(snapshot instanceof Set, true);
  for (const entry of snapshot) {
    assertEquals(typeof entry, "string");
    assertEquals(entry.length > 0, true);
  }
});

Deno.test("FR-E37 an empty allowed_paths rejects every new modification", () => {
  // A branch that declares no write scope gets `[]` rather than "no check",
  // so anything it touches is a violation.
  assertEquals(
    findViolations(new Set(["pre.txt"]), new Set(["pre.txt", "new.txt"]), []),
    ["new.txt"],
  );
  assertEquals(
    findViolations(new Set(["pre.txt"]), new Set(["pre.txt"]), []),
    [],
  );
});

/**
 * FR-E37 end to end: two nodes of one run share the run's tree, so the
 * repository-wide snapshot each of them takes also sees what the other wrote.
 * The check therefore brackets the running set once against the union of their
 * scopes — a node may not be failed for a sibling's in-scope write.
 */
Deno.test("FR-E37 two shared-tree nodes running together survive each other's writes", async () => {
  const dir = await Deno.makeTempDir();
  const origCwd = Deno.cwd();
  const git = async (...args: string[]) => {
    const out = await new Deno.Command("git", {
      args,
      cwd: dir,
      stdout: "null",
      stderr: "piped",
    }).output();
    if (!out.success) {
      throw new Error(
        `git ${args.join(" ")}: ${new TextDecoder().decode(out.stderr)}`,
      );
    }
  };
  await git("init", "--initial-branch=main");
  await git("config", "user.email", "test@test.com");
  await git("config", "user.name", "Test");
  await Deno.writeTextFile(`${dir}/README.md`, "initial\n");
  await git("add", "README.md");
  await git("commit", "-m", "init");

  await Deno.writeTextFile(
    `${dir}/workflow.yaml`,
    [
      "name: shared-tree",
      "version: '1'",
      "defaults:",
      "  worktree_disabled: true",
      "  max_parallel: 2",
      // A scope violation must fail the node outright rather than buy an
      // extra agent turn — otherwise this test passes whether or not the
      // check ever runs.
      "  max_continuations: 0",
      "nodes:",
      "  alpha:",
      "    type: agent",
      "    label: Alpha",
      "    runtime: opencode",
      "    prompt: write alpha",
      "    allowed_paths: ['out/alpha/**']",
      "  beta:",
      "    type: agent",
      "    label: Beta",
      "    runtime: opencode",
      "    prompt: write beta",
      "    allowed_paths: ['out/beta/**']",
      "",
    ].join("\n"),
  );

  // Both invocations are held until the second one arrives, so each node's
  // before/after snapshot definitely spans the other node's write.
  let release!: () => void;
  const bothStarted = new Promise<void>((resolve) => (release = resolve));
  let started = 0;

  try {
    Deno.chdir(dir);
    const engine = new Engine({
      config_path: "workflow.yaml",
      run_id: "run-shared-tree",
      verbosity: "quiet",
      args: {},
      env_overrides: {},
      lock_path: "test.lock",
      runtimeAdapter: createFakeRuntime(async ({ opts, reply, write }) => {
        const name = opts.taskPrompt.includes("alpha") ? "alpha" : "beta";
        if (++started === 2) release();
        await bothStarted;
        await write(`out/${name}/file.txt`, `${name}\n`);
        return reply({ result: `wrote ${name}` });
      }),
    });
    const state = await engine.run();

    assertEquals(state.nodes.alpha.status, "completed");
    assertEquals(state.nodes.beta.status, "completed");
    assertEquals(
      await Deno.readTextFile(`${dir}/out/alpha/file.txt`),
      "alpha\n",
    );
    assertEquals(await Deno.readTextFile(`${dir}/out/beta/file.txt`), "beta\n");
  } finally {
    Deno.chdir(origCwd);
    await Deno.remove(dir, { recursive: true });
  }
});
