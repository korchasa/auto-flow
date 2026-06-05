import { assertEquals } from "@std/assert";
import {
  rollbackLeaks,
  runWithGuardrail,
  snapshotMainTree,
} from "./guardrail.ts";

// Integration tests for FR-E50 guardrail. Each test sets up an ad-hoc git
// repo in a temp dir, simulates an agent that "leaks" a file into the main
// tree, and asserts the wrapper's behavior. The wrapper is what gets wired
// into node-dispatch.ts::executeAgentNode.

async function git(cwd: string, ...args: string[]): Promise<void> {
  const out = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!out.success) {
    const stderr = new TextDecoder().decode(out.stderr);
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${stderr}`);
  }
}

async function setupRepo(): Promise<string> {
  const repo = await Deno.makeTempDir();
  await git(repo, "init", "--initial-branch=main");
  await git(repo, "config", "user.email", "test@test.com");
  await git(repo, "config", "user.name", "Test");
  await Deno.writeTextFile(`${repo}/README.md`, "initial\n");
  await git(repo, "add", "README.md");
  await git(repo, "commit", "-m", "init");
  // Pretend worktree dir lives under wt/ relative to repo.
  await Deno.mkdir(`${repo}/wt`, { recursive: true });
  return repo;
}

Deno.test("snapshotMainTree — clean repo returns empty set", async () => {
  const repo = await setupRepo();
  try {
    const snap = await snapshotMainTree(repo);
    assertEquals(snap.size, 0);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("snapshotMainTree — picks up untracked and modified files", async () => {
  const repo = await setupRepo();
  try {
    await Deno.writeTextFile(`${repo}/README.md`, "modified\n");
    await Deno.writeTextFile(`${repo}/new.md`, "new file\n");
    const snap = await snapshotMainTree(repo);
    assertEquals(snap.has("README.md"), true);
    assertEquals(snap.has("new.md"), true);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("rollbackLeaks — restores tracked file and removes new file", async () => {
  const repo = await setupRepo();
  try {
    await Deno.writeTextFile(`${repo}/README.md`, "leak\n");
    await Deno.writeTextFile(`${repo}/leaked.md`, "leak\n");
    await rollbackLeaks(repo, ["README.md", "leaked.md"]);

    const restored = await Deno.readTextFile(`${repo}/README.md`);
    assertEquals(restored, "initial\n");

    let leakedExists = true;
    try {
      await Deno.stat(`${repo}/leaked.md`);
    } catch {
      leakedExists = false;
    }
    assertEquals(leakedExists, false);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("guardrail rolls back only leaked files (rollback scope)", async () => {
  // Pre-existing dirty file in main must not be rolled back by guardrail —
  // it predates the agent and is therefore not the agent's leak.
  const repo = await setupRepo();
  try {
    await Deno.writeTextFile(`${repo}/preexisting.md`, "user-edit\n");

    const fn = async () => {
      await Deno.writeTextFile(`${repo}/leaked.md`, "agent-leak\n");
      return "ok";
    };

    const { leak } = await runWithGuardrail(
      { repoRoot: repo, workDir: "wt", allowedPaths: [], nodeId: "build" },
      fn,
    );
    assertEquals(leak?.paths, ["leaked.md"]);

    // pre-existing modification still present (untouched by rollback)
    const pre = await Deno.readTextFile(`${repo}/preexisting.md`);
    assertEquals(pre, "user-edit\n");

    // Leaked file removed by rollback
    let leakedExists = true;
    try {
      await Deno.stat(`${repo}/leaked.md`);
    } catch {
      leakedExists = false;
    }
    assertEquals(leakedExists, false);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("guardrail fails node when agent writes outside workDir", async () => {
  const repo = await setupRepo();
  try {
    const fn = async () => {
      await Deno.writeTextFile(`${repo}/outside.md`, "leaked\n");
      return { success: true };
    };

    const messages: string[] = [];
    const outcome = await runWithGuardrail(
      {
        repoRoot: repo,
        workDir: "wt",
        allowedPaths: [],
        nodeId: "verify",
        log: (m) => messages.push(m),
      },
      fn,
    );

    assertEquals(outcome.leak?.paths, ["outside.md"]);
    assertEquals(messages.length, 1);
    assertEquals(messages[0].includes("node=verify"), true);
    assertEquals(messages[0].includes("outside.md"), true);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("guardrail noop when worktree disabled (workDir=.)", async () => {
  const repo = await setupRepo();
  try {
    let logCalled = false;
    const fn = async () => {
      await Deno.writeTextFile(`${repo}/anything.md`, "x\n");
      return 42;
    };

    const outcome = await runWithGuardrail(
      {
        repoRoot: repo,
        workDir: ".",
        allowedPaths: [],
        nodeId: "n",
        log: () => {
          logCalled = true;
        },
      },
      fn,
    );

    assertEquals(outcome.result, 42);
    assertEquals(outcome.leak, undefined);
    assertEquals(logCalled, false);
    // File NOT rolled back — guardrail is fully disabled.
    const exists = await Deno.stat(`${repo}/anything.md`).then(
      () => true,
      () => false,
    );
    assertEquals(exists, true);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("guardrail logs leaked paths at default verbosity", async () => {
  const repo = await setupRepo();
  try {
    const messages: string[] = [];
    const fn = async () => {
      await Deno.writeTextFile(`${repo}/a.md`, "1\n");
      await Deno.writeTextFile(`${repo}/b.md`, "2\n");
      return null;
    };

    await runWithGuardrail(
      {
        repoRoot: repo,
        workDir: "wt",
        allowedPaths: [],
        nodeId: "build",
        log: (m) => messages.push(m),
      },
      fn,
    );

    assertEquals(messages.length, 1);
    assertEquals(
      messages[0],
      "[guardrail] node=build leaked 2 file(s): a.md, b.md (rolled back)",
    );
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("guardrail allows files matching allowedPaths globs", async () => {
  const repo = await setupRepo();
  try {
    const fn = async () => {
      await Deno.writeTextFile(`${repo}/CHANGELOG.md`, "release\n");
      return null;
    };

    const outcome = await runWithGuardrail(
      {
        repoRoot: repo,
        workDir: "wt",
        allowedPaths: ["CHANGELOG.md"],
        nodeId: "release",
      },
      fn,
    );

    assertEquals(outcome.leak, undefined);
    // File preserved (whitelisted).
    const exists = await Deno.stat(`${repo}/CHANGELOG.md`).then(
      () => true,
      () => false,
    );
    assertEquals(exists, true);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});
