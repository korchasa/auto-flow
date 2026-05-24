import { assertEquals, assertRejects } from "@std/assert";
import {
  buildCloneUrl,
  commitMessage,
  parseSyncCliArgs,
  syncPluginsRepo,
  TARGET_REPO,
  workingTreeIsDirty,
} from "./sync-plugins-repo.ts";
import type { ClaudeOutput, GitOutput } from "./sync-plugins-repo.ts";

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

Deno.test("FR-E72 parseSyncCliArgs — --install-local shortcut", () => {
  const parsed = parseSyncCliArgs(["--version", "1.0.0", "--install-local"]);
  if ("help" in parsed) throw new Error("unexpected help");
  assertEquals(parsed.mode, "install-local");
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
  noClaude?: boolean;
}) {
  const gitCalls: GitCall[] = [];
  const claudeCalls: string[][] = [];
  // Track temp dirs we actually create so the integration parts of the
  // sync flow (readDir / copyFile / status) have real bytes to read.
  const createdDirs: string[] = [];
  return {
    gitCalls,
    claudeCalls,
    createdDirs,
    runGit: (
      args: string[],
      gitOpts?: { cwd?: string },
    ): Promise<GitOutput> => {
      gitCalls.push({ args: [...args], cwd: gitOpts?.cwd });
      // Stub out the specific commands the publish flow needs.
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
    runClaude: opts.noClaude
      ? () => Promise.resolve(null)
      : (args: string[]): Promise<ClaudeOutput | null> => {
        claudeCalls.push([...args]);
        return Promise.resolve({ success: true, stdout: "", stderr: "" });
      },
    buildPayload: async (
      { outDir }: { outDir: string; version: string },
    ) => {
      // Drop a sentinel file so syncDirectoryContents has something to
      // copy and `git status --porcelain` would naturally report dirt
      // (we stub the porcelain output above; this just keeps the real
      // copy path happy).
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
  // No commit / tag / push must have been issued.
  const gitVerbs = mocks.gitCalls.map((c) => c.args[0]);
  // commit may appear with -c options earlier; check by full args.
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
  // Clone + status + rev-parse are expected.
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

Deno.test("FR-E72 --install-local — registers marketplace + installs via claude", async () => {
  const mocks = makeMocks({});
  const result = await syncPluginsRepo(
    { engineRoot: "/eng", version: "1.0.0", mode: "install-local" },
    mocks,
  );
  assertEquals(result.mode, "install-local");
  assertEquals(result.claudeMissing, false);
  // Expect: marketplace remove + marketplace add + install (and possibly
  // update fallback). Compare verb-prefixes by joining the first two args.
  const verbs = mocks.claudeCalls.map((c) => c.slice(0, 2).join(" "));
  if (!verbs.includes("plugin marketplace")) {
    throw new Error(`missing 'plugin marketplace': ${verbs.join(" | ")}`);
  }
  // Look for plugin install <id> shape.
  if (
    !mocks.claudeCalls.some((c) => c[0] === "plugin" && c[1] === "install")
  ) {
    throw new Error(`missing 'plugin install': ${verbs.join(" | ")}`);
  }
  // remove + add both came through.
  const marketplaceVerbs = mocks.claudeCalls
    .filter((c) => c[0] === "plugin" && c[1] === "marketplace")
    .map((c) => c[2]);
  if (!marketplaceVerbs.includes("remove")) {
    throw new Error(
      `missing marketplace remove: ${JSON.stringify(marketplaceVerbs)}`,
    );
  }
  if (!marketplaceVerbs.includes("add")) {
    throw new Error(
      `missing marketplace add: ${JSON.stringify(marketplaceVerbs)}`,
    );
  }
});

Deno.test("FR-E72 --install-local soft-skips without claude CLI", async () => {
  const mocks = makeMocks({ noClaude: true });
  const result = await syncPluginsRepo(
    { engineRoot: "/eng", version: "1.0.0", mode: "install-local" },
    mocks,
  );
  assertEquals(result.claudeMissing, true);
  assertEquals(result.changed, false);
});

Deno.test("FR-E72 publish uses correct target repo default", () => {
  assertEquals(TARGET_REPO, "korchasa/flowai-workflow-plugins");
});
