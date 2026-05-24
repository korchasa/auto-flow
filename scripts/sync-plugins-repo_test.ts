import { assertEquals, assertRejects } from "@std/assert";
import {
  buildCloneUrl,
  commitMessage,
  parseSyncCliArgs,
  syncPluginsRepo,
  TARGET_REPO,
  workingTreeIsDirty,
} from "./sync-plugins-repo.ts";
import type { GitOutput } from "./sync-plugins-repo.ts";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

Deno.test("FR-E72 buildCloneUrl — embeds token into github.com URL", () => {
  assertEquals(
    buildCloneUrl("korchasa/flowai-workflow-plugins", "ghp_secret123"),
    "https://x-access-token:ghp_secret123@github.com/korchasa/flowai-workflow-plugins.git",
  );
});

Deno.test("FR-E72 workingTreeIsDirty — empty porcelain means clean", () => {
  assertEquals(workingTreeIsDirty(""), false);
  assertEquals(workingTreeIsDirty("\n\n"), false);
});

Deno.test("FR-E72 workingTreeIsDirty — any non-blank line means dirty", () => {
  assertEquals(workingTreeIsDirty(" M plugins/foo.ts"), true);
  assertEquals(workingTreeIsDirty("?? new.md\n"), true);
});

Deno.test("FR-E72 commitMessage — embeds short SHA + version", () => {
  const msg = commitMessage(
    "0.7.12",
    "abcdef1234567890abcdef1234567890abcdef12",
  );
  assertEquals(msg, "release: v0.7.12 (synced from engine@abcdef123456)");
});

Deno.test("FR-E72 parseSyncCliArgs — explicit publish mode is the default", () => {
  const parsed = parseSyncCliArgs(["--version", "1.0.0"]);
  if ("help" in parsed) throw new Error("unexpected help");
  assertEquals(parsed.mode, "publish");
  assertEquals(parsed.version, "1.0.0");
});

Deno.test("FR-E72 parseSyncCliArgs — --dry-run shortcut", () => {
  const parsed = parseSyncCliArgs(["--version", "1.0.0", "--dry-run"]);
  if ("help" in parsed) throw new Error("unexpected help");
  assertEquals(parsed.mode, "dry-run");
});

Deno.test("FR-E72 parseSyncCliArgs — rejects removed install-local mode", () => {
  let threw = false;
  try {
    parseSyncCliArgs(["--version", "1.0.0", "--mode", "install-local"]);
  } catch (err) {
    threw = true;
    if (!(err instanceof Error) || !err.message.includes("publish, dry-run")) {
      throw new Error(`unexpected error: ${err}`);
    }
  }
  if (!threw) throw new Error("expected parseSyncCliArgs to throw");
});

// ---------------------------------------------------------------------------
// Integration via dependency injection.
// ---------------------------------------------------------------------------

interface GitCall {
  args: string[];
  cwd?: string;
}

function makeMocks(opts: {
  porcelain?: string;
  shaHead?: string;
}) {
  const gitCalls: GitCall[] = [];
  const createdDirs: string[] = [];
  return {
    gitCalls,
    createdDirs,
    runGit: (
      args: string[],
      gitOpts?: { cwd?: string },
    ): Promise<GitOutput> => {
      gitCalls.push({ args: [...args], cwd: gitOpts?.cwd });
      if (args[0] === "status" && args[1] === "--porcelain") {
        return Promise.resolve({
          success: true,
          stdout: opts.porcelain ?? "",
          stderr: "",
        });
      }
      if (args[0] === "rev-parse" && args[1] === "HEAD") {
        return Promise.resolve({
          success: true,
          stdout: (opts.shaHead ??
            "0123456789abcdef0123456789abcdef01234567") + "\n",
          stderr: "",
        });
      }
      return Promise.resolve({ success: true, stdout: "", stderr: "" });
    },
    buildPayload: async (
      { outDir }: { outDir: string; version: string },
    ) => {
      await Deno.mkdir(outDir, { recursive: true });
      await Deno.writeTextFile(`${outDir}/sentinel.txt`, "x");
      return {
        filesWritten: [
          `${outDir}/plugins/flowai-workflow/engine/cli.ts`,
          `${outDir}/.claude-plugin/marketplace.json`,
        ],
        manifestsUpdated: [
          `${outDir}/.claude-plugin/marketplace.json`,
          `${outDir}/plugins/flowai-workflow/.claude-plugin/plugin.json`,
        ],
      };
    },
    makeTempDir: async (prefix: string) => {
      const dir = await Deno.makeTempDir({ prefix });
      createdDirs.push(dir);
      return dir;
    },
    removeDir: async (path: string) => {
      await Deno.remove(path, { recursive: true }).catch(() => {});
    },
  };
}

Deno.test("FR-E72 idempotent no-op — clean working tree skips commit/push", async () => {
  const mocks = makeMocks({ porcelain: "" });
  const result = await syncPluginsRepo(
    {
      engineRoot: "/eng",
      version: "1.2.3",
      mode: "publish",
      token: "ghp_test",
    },
    mocks,
  );
  assertEquals(result.changed, false);
  assertEquals(result.tag, null);
  const gitVerbs = mocks.gitCalls.map((c) => c.args[0]);
  const issued = mocks.gitCalls.map((c) => c.args.join(" "));
  if (issued.some((s) => s.includes("commit"))) {
    throw new Error(`commit issued on clean tree: ${issued.join(" | ")}`);
  }
  if (issued.some((s) => s.startsWith("tag "))) {
    throw new Error(`tag issued on clean tree: ${issued.join(" | ")}`);
  }
  if (issued.some((s) => s.startsWith("push "))) {
    throw new Error(`push issued on clean tree: ${issued.join(" | ")}`);
  }
  if (!gitVerbs.includes("clone")) {
    throw new Error("expected clone to happen");
  }
});

Deno.test("FR-E72 push+tag on diff — dirty working tree commits and pushes vX.Y.Z", async () => {
  const mocks = makeMocks({
    porcelain: " M plugins/flowai-workflow/engine/cli.ts\n",
    shaHead: "deadbeef0000111122223333444455556666aaaa",
  });
  const result = await syncPluginsRepo(
    {
      engineRoot: "/eng",
      version: "9.9.9",
      mode: "publish",
      token: "ghp_test",
    },
    mocks,
  );
  assertEquals(result.changed, true);
  assertEquals(result.tag, "v9.9.9");
  const issued = mocks.gitCalls.map((c) => c.args.join(" "));
  if (!issued.some((s) => s.startsWith("add -A"))) {
    throw new Error(`expected 'add -A'; got: ${issued.join(" | ")}`);
  }
  if (
    !issued.some((s) =>
      s.includes("commit") && s.includes("v9.9.9") && s.includes("deadbeef0000")
    )
  ) {
    throw new Error(
      `expected commit with v9.9.9 + short SHA; got: ${issued.join(" | ")}`,
    );
  }
  if (!issued.some((s) => s.startsWith("tag -a v9.9.9"))) {
    throw new Error(`expected 'tag -a v9.9.9'; got: ${issued.join(" | ")}`);
  }
  if (
    !issued.some((s) => s.startsWith("push origin HEAD:main v9.9.9"))
  ) {
    throw new Error(
      `expected 'push origin HEAD:main v9.9.9'; got: ${issued.join(" | ")}`,
    );
  }
});

Deno.test("FR-E72 publish without token throws", async () => {
  Deno.env.delete("PLUGINS_REPO_TOKEN");
  const mocks = makeMocks({ porcelain: "" });
  await assertRejects(
    () =>
      syncPluginsRepo(
        { engineRoot: "/eng", version: "1.0.0", mode: "publish" },
        mocks,
      ),
    Error,
    "publish mode requires",
  );
});

Deno.test("FR-E72 dry-run mode — builds payload, issues no git ops", async () => {
  const mocks = makeMocks({ porcelain: "" });
  const result = await syncPluginsRepo(
    {
      engineRoot: "/eng",
      version: "1.0.0",
      mode: "dry-run",
      outDir: "/tmp/foo",
    },
    mocks,
  );
  assertEquals(result.mode, "dry-run");
  assertEquals(result.filesWritten, 2);
  assertEquals(mocks.gitCalls.length, 0);
});

Deno.test("FR-E72 publish uses correct target repo default", () => {
  assertEquals(TARGET_REPO, "korchasa/flowai-workflow-plugins");
});
