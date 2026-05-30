/**
 * Tests for the plugin launcher script
 * (`plugin-src/shared/bin/launch.ts`, FR-E74).
 *
 * Two layers:
 *
 * 1. Pure-helper unit tests — import the exported helpers from
 *    `bin/launch.ts` and assert on small in-memory fixtures. Fast,
 *    no subprocess.
 *
 * 2. Integration tests — spawn the real launcher via `deno run -A
 *    bin/launch.ts ...` against a temp `CLAUDE_PLUGIN_ROOT` +
 *    `CLAUDE_PLUGIN_DATA` fixture. A fake `deno` shim on PATH
 *    intercepts the `deno compile` step and materialises a stub
 *    binary at `--output`; the stub binary logs its argv so we can
 *    assert on what the launcher passed through.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join, resolve } from "@std/path";

import {
  buildCompileArgs,
  codexDataDir,
  enumerateBundledWorkflowFiles,
  readPluginVersion,
  resolvePluginData,
  resolvePluginRoot,
  resolveWorkflowDir,
} from "../plugin-src/shared/bin/launch.ts";

const LAUNCHER_SRC = resolve(
  "plugin-src/shared/bin/launch.ts",
);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

Deno.test("FR-E74 readPluginVersion extracts version field", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "launch-test-" });
  try {
    await Deno.mkdir(join(tmp, ".claude-plugin"));
    await Deno.writeTextFile(
      join(tmp, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "x", version: "1.2.3" }),
    );
    assertEquals(await readPluginVersion(tmp), "1.2.3");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("FR-E74 readPluginVersion throws on missing version", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "launch-test-" });
  try {
    await Deno.mkdir(join(tmp, ".claude-plugin"));
    await Deno.writeTextFile(
      join(tmp, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "x" }),
    );
    let threw = false;
    try {
      await readPluginVersion(tmp);
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("FR-E74 readPluginVersion supports Codex plugin manifest", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "launch-test-" });
  try {
    await Deno.mkdir(join(tmp, ".codex-plugin"));
    await Deno.writeTextFile(
      join(tmp, ".codex-plugin", "plugin.json"),
      JSON.stringify({ name: "x", version: "4.5.6" }),
    );
    assertEquals(await readPluginVersion(tmp), "4.5.6");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("FR-E74 launcher pure helpers resolve Codex defaults", () => {
  assertEquals(
    codexDataDir({ CODEX_HOME: "/tmp/codex-home", HOME: "/tmp/home" }),
    "/tmp/codex-home/plugins/data/flowai-workflow",
  );
  assertEquals(
    codexDataDir({ HOME: "/tmp/home" }),
    "/tmp/home/.codex/plugins/data/flowai-workflow",
  );
  assertEquals(
    resolvePluginData({ CODEX_HOME: "/tmp/codex-home" }),
    "/tmp/codex-home/plugins/data/flowai-workflow",
  );
  assertEquals(
    resolvePluginRoot(
      { CLAUDE_PLUGIN_ROOT: "/plugin" },
      "file:///ignored/bin/launch.ts",
    ),
    "/plugin",
  );
  assertEquals(
    resolvePluginRoot({}, "file:///plugin/bin/launch.ts"),
    "/plugin",
  );
});

Deno.test(
  "FR-E74 enumerateBundledWorkflowFiles recursively walks the bundle dir",
  async () => {
    const tmp = await Deno.makeTempDir({ prefix: "launch-test-" });
    try {
      const root = join(tmp, ".flowai-workflow");
      await Deno.mkdir(join(root, "wf1", "agents"), { recursive: true });
      await Deno.writeTextFile(
        join(root, "wf1", "workflow.yaml"),
        "nodes: []\n",
      );
      await Deno.writeTextFile(
        join(root, "wf1", "agents", "pm.md"),
        "# pm",
      );
      const files = await enumerateBundledWorkflowFiles(tmp);
      // Returns sorted absolute paths covering both depth-1 and depth-2 files.
      assertEquals(files.length, 2);
      assertStringIncludes(files[0], "/wf1/");
      assert(files.every((f) => f.startsWith(root)));
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  "FR-E74 enumerateBundledWorkflowFiles returns [] when bundle dir missing",
  async () => {
    const tmp = await Deno.makeTempDir({ prefix: "launch-test-" });
    try {
      assertEquals(await enumerateBundledWorkflowFiles(tmp), []);
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  "FR-E74 resolveWorkflowDir prefers FLOWAI_WORKFLOW env override",
  async () => {
    const wf = await resolveWorkflowDir({
      env: { FLOWAI_WORKFLOW: "/explicit/path" },
      projectRoot: "/irrelevant",
    });
    assertEquals(wf, "/explicit/path");
  },
);

Deno.test(
  "FR-E74 resolveWorkflowDir returns the single candidate folder",
  async () => {
    const tmp = await Deno.makeTempDir({ prefix: "launch-test-" });
    try {
      await Deno.mkdir(join(tmp, ".flowai-workflow", "only"), {
        recursive: true,
      });
      await Deno.writeTextFile(
        join(tmp, ".flowai-workflow", "only", "workflow.yaml"),
        "nodes: []\n",
      );
      const wf = await resolveWorkflowDir({
        env: {},
        projectRoot: tmp,
      });
      assertEquals(wf, join(tmp, ".flowai-workflow", "only"));
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  "FR-E74 resolveWorkflowDir falls back to github-inbox on ambiguity",
  async () => {
    const tmp = await Deno.makeTempDir({ prefix: "launch-test-" });
    try {
      for (const name of ["github-inbox", "other"]) {
        await Deno.mkdir(join(tmp, ".flowai-workflow", name), {
          recursive: true,
        });
        await Deno.writeTextFile(
          join(tmp, ".flowai-workflow", name, "workflow.yaml"),
          "nodes: []\n",
        );
      }
      const wf = await resolveWorkflowDir({
        env: {},
        projectRoot: tmp,
      });
      assertEquals(wf, join(tmp, ".flowai-workflow", "github-inbox"));
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  "FR-E74 resolveWorkflowDir returns null when no candidate exists",
  async () => {
    const tmp = await Deno.makeTempDir({ prefix: "launch-test-" });
    try {
      // No .flowai-workflow dir at all.
      assertEquals(
        await resolveWorkflowDir({ env: {}, projectRoot: tmp }),
        null,
      );
      // Ambiguous WITHOUT github-inbox → null (caller passes --no-workflow).
      for (const name of ["a", "b"]) {
        await Deno.mkdir(join(tmp, ".flowai-workflow", name), {
          recursive: true,
        });
        await Deno.writeTextFile(
          join(tmp, ".flowai-workflow", name, "workflow.yaml"),
          "nodes: []\n",
        );
      }
      assertEquals(
        await resolveWorkflowDir({ env: {}, projectRoot: tmp }),
        null,
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  "FR-E74 buildCompileArgs interleaves --include per file and ends with entry",
  () => {
    const args = buildCompileArgs(
      "/abs/engine/cli.ts",
      ["/abs/.flowai-workflow/a.yaml", "/abs/.flowai-workflow/b.md"],
      "/abs/data/bin/x.tmp",
    );
    // Must start with `compile --allow-all --no-check`.
    assertEquals(args[0], "compile");
    assertStringIncludes(args.join(" "), "--allow-all");
    assertStringIncludes(args.join(" "), "--no-check");
    // Each include file must be preceded by `--include`.
    const includeIdx = args.findIndex((a) => a === "--include");
    assertEquals(args[includeIdx + 1], "/abs/.flowai-workflow/a.yaml");
    // Output flag + entry come last.
    const outIdx = args.indexOf("--output");
    assertEquals(args[outIdx + 1], "/abs/data/bin/x.tmp");
    assertEquals(args[args.length - 1], "/abs/engine/cli.ts");
  },
);

Deno.test("FR-E74 buildCompileArgs works with empty includes", () => {
  const args = buildCompileArgs("/cli.ts", [], "/tmp.bin");
  assertEquals(args.includes("--include"), false);
  assertEquals(args[args.length - 1], "/cli.ts");
});

// ---------------------------------------------------------------------------
// Integration tests — spawn the real launcher
// ---------------------------------------------------------------------------

interface IntFixture {
  pluginRoot: string;
  pluginData: string;
  projectRoot: string;
  shimDir: string;
  denoLog: string;
  binLog: string;
  cleanup: () => Promise<void>;
}

interface IntFixtureOpts {
  version?: string;
  prePopulateBinary?: boolean;
  projectWorkflows?: Record<string, string>;
  /** Stub-binary body. Default: log argv to binLog and exit 0. */
  stubBinaryBody?: string;
}

async function setupIntFixture(
  opts: IntFixtureOpts = {},
): Promise<IntFixture> {
  const version = opts.version ?? "9.9.9";
  const tmp = await Deno.makeTempDir({ prefix: "launch-int-" });
  const pluginRoot = join(tmp, "plugin");
  const pluginData = join(tmp, "data");
  const projectRoot = join(tmp, "project");
  const shimDir = join(tmp, "shim");
  await Deno.mkdir(join(pluginRoot, "engine"), { recursive: true });
  await Deno.mkdir(join(pluginRoot, "bin"), { recursive: true });
  await Deno.mkdir(join(pluginRoot, ".claude-plugin"), { recursive: true });
  await Deno.mkdir(pluginData, { recursive: true });
  await Deno.mkdir(projectRoot, { recursive: true });
  await Deno.mkdir(shimDir, { recursive: true });

  await Deno.copyFile(LAUNCHER_SRC, join(pluginRoot, "bin", "launch.ts"));
  await Deno.writeTextFile(
    join(pluginRoot, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "flowai-workflow", version }, null, 2),
  );
  await Deno.writeTextFile(
    join(pluginRoot, "engine", "cli.ts"),
    "console.log('stub')\n",
  );

  for (
    const [rel, content] of Object.entries(opts.projectWorkflows ?? {})
  ) {
    const abs = join(projectRoot, rel);
    const parent = abs.substring(0, abs.lastIndexOf("/"));
    await Deno.mkdir(parent, { recursive: true });
    await Deno.writeTextFile(abs, content);
  }

  const denoLog = join(tmp, "deno-invocations.log");
  const binLog = join(tmp, "binary-invocations.log");

  // Stub binary body: by default log argv as JSON line and exit 0.
  const defaultStub = `#!/usr/bin/env bash
exec python3 -c 'import sys,json; open("__BINLOG__","a").write(json.dumps(sys.argv[1:])+"\\n")' "$@"
`;
  const stubBody = (opts.stubBinaryBody ?? defaultStub)
    .replace(/__BINLOG__/g, binLog);

  // Fake `deno` shim: intercept `deno compile ... --output <path> <entry>`
  // and write the stub binary at <path>. For `deno run` (which we DO
  // need to spawn the real launcher via the real Deno), the shim
  // delegates to the host's real Deno. The shim sniffs argv[0].
  const realDeno = Deno.execPath();
  const shimBody = `#!/usr/bin/env bash
set -e
if [[ "\${1:-}" == "compile" ]]; then
  # Log the compile invocation.
  python3 -c 'import sys; print("\\x1f".join(sys.argv[1:]))' "$@" >> "${denoLog}"
  # Extract --output target.
  out=""
  prev=""
  for a in "$@"; do
    if [[ "$prev" == "--output" ]]; then out="$a"; fi
    prev="$a"
  done
  if [[ -n "$out" ]]; then
    cat > "$out" <<'STUBEOF'
${stubBody}STUBEOF
    chmod +x "$out"
  fi
  exit 0
fi
# Anything else: delegate to real Deno.
exec "${realDeno}" "$@"
`;
  await Deno.writeTextFile(join(shimDir, "deno"), shimBody);
  await Deno.chmod(join(shimDir, "deno"), 0o755);

  if (opts.prePopulateBinary) {
    const cachedBin = join(
      pluginData,
      "bin",
      `flowai-workflow-${version}`,
    );
    await Deno.mkdir(join(pluginData, "bin"), { recursive: true });
    await Deno.writeTextFile(cachedBin, stubBody);
    await Deno.chmod(cachedBin, 0o755);
  }

  return {
    pluginRoot,
    pluginData,
    projectRoot,
    shimDir,
    denoLog,
    binLog,
    cleanup: () => Deno.remove(tmp, { recursive: true }),
  };
}

interface RunOpts {
  args: string[];
  env?: Record<string, string | undefined>;
  /** When set, scrub the shim from PATH and use this PATH instead. */
  pathOverride?: string;
  fx: IntFixture;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runLauncher(opts: RunOpts): Promise<RunResult> {
  const env: Record<string, string> = {
    CLAUDE_PLUGIN_ROOT: opts.fx.pluginRoot,
    CLAUDE_PLUGIN_DATA: opts.fx.pluginData,
    PATH: opts.pathOverride ?? `${opts.fx.shimDir}:/usr/bin:/bin`,
    HOME: opts.fx.pluginRoot,
  };
  for (const [key, value] of Object.entries(opts.env ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  // We spawn via the shim's `deno` (which delegates `run` to the real
  // Deno) so the launcher's own `deno compile` call hits the shim.
  const cmd = new Deno.Command(join(opts.fx.shimDir, "deno"), {
    args: [
      "run",
      "-A",
      "--no-check",
      join(opts.fx.pluginRoot, "bin", "launch.ts"),
      ...opts.args,
    ],
    env,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  });
  const out = await cmd.output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

async function readBinLog(fx: IntFixture): Promise<unknown[]> {
  try {
    const txt = await Deno.readTextFile(fx.binLog);
    return txt.split("\n").filter((s) => s.length > 0).map((l) =>
      JSON.parse(l)
    );
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return [];
    throw e;
  }
}

async function readDenoLog(fx: IntFixture): Promise<string[]> {
  try {
    const txt = await Deno.readTextFile(fx.denoLog);
    return txt.split("\n").filter((s) => s.length > 0);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return [];
    throw e;
  }
}

Deno.test(
  "FR-E74 end-to-end launcher compiles on first call and execs cached binary on second",
  async () => {
    const fx = await setupIntFixture({ version: "1.2.3" });
    try {
      const r1 = await runLauncher({ fx, args: ["--version"] });
      assertEquals(r1.code, 0, `first stderr: ${r1.stderr}`);
      const r2 = await runLauncher({ fx, args: ["--version"] });
      assertEquals(r2.code, 0);
      const denoLog = await readDenoLog(fx);
      assertEquals(
        denoLog.length,
        1,
        `expected one compile invocation; got ${denoLog.length}`,
      );
      const stat = await Deno.stat(
        join(fx.pluginData, "bin", "flowai-workflow-1.2.3"),
      );
      assert(stat.isFile);
    } finally {
      await fx.cleanup();
    }
  },
);

Deno.test(
  "FR-E74 launcher skips compile when binary cached and forwards args",
  async () => {
    const fx = await setupIntFixture({
      version: "0.5.0",
      prePopulateBinary: true,
    });
    try {
      const r = await runLauncher({ fx, args: ["--help"] });
      assertEquals(r.code, 0, `stderr: ${r.stderr}`);
      const denoLog = await readDenoLog(fx);
      assertEquals(denoLog.length, 0, "expected NO compile call");
      const binLog = await readBinLog(fx);
      assertEquals(binLog, [["--help"]]);
    } finally {
      await fx.cleanup();
    }
  },
);

Deno.test(
  "FR-E74 launcher resolves plugin root from import meta without Claude env",
  async () => {
    const fx = await setupIntFixture({
      version: "0.6.0",
      prePopulateBinary: true,
    });
    try {
      const r = await runLauncher({
        fx,
        args: ["--help"],
        env: {
          CLAUDE_PLUGIN_ROOT: undefined,
          CLAUDE_PLUGIN_DATA: undefined,
          FLOWAI_PLUGIN_DATA: fx.pluginData,
        },
      });
      assertEquals(r.code, 0, `stderr: ${r.stderr}`);
      const binLog = await readBinLog(fx);
      assertEquals(binLog, [["--help"]]);
    } finally {
      await fx.cleanup();
    }
  },
);

Deno.test(
  "FR-E74 launcher resolves single workflow folder for mcp subcommand",
  async () => {
    const fx = await setupIntFixture({
      version: "0.1.0",
      prePopulateBinary: true,
      projectWorkflows: {
        ".flowai-workflow/foo/workflow.yaml": "nodes: []\n",
      },
    });
    try {
      const r = await runLauncher({
        fx,
        args: ["mcp"],
        env: { CLAUDE_PROJECT_DIR: fx.projectRoot },
      });
      assertEquals(r.code, 0, `stderr: ${r.stderr}`);
      const binLog = await readBinLog(fx);
      assertEquals(binLog.length, 1);
      const argv = binLog[0] as string[];
      assertEquals(argv[0], "mcp");
      assertStringIncludes(argv[1], "/project/.flowai-workflow/foo");
    } finally {
      await fx.cleanup();
    }
  },
);

Deno.test(
  "FR-E74 launcher passes --no-workflow when none found",
  async () => {
    const fx = await setupIntFixture({
      version: "0.1.0",
      prePopulateBinary: true,
    });
    try {
      const r = await runLauncher({
        fx,
        args: ["mcp"],
        env: { CLAUDE_PROJECT_DIR: fx.projectRoot },
      });
      assertEquals(r.code, 0, `stderr: ${r.stderr}`);
      const binLog = await readBinLog(fx);
      assertEquals(binLog, [["mcp", "--no-workflow"]]);
    } finally {
      await fx.cleanup();
    }
  },
);

Deno.test(
  "FR-E74 launcher propagates child exit code",
  async () => {
    const fx = await setupIntFixture({
      version: "0.2.0",
      prePopulateBinary: true,
      stubBinaryBody: `#!/usr/bin/env bash
exit 42
`,
    });
    try {
      const r = await runLauncher({ fx, args: ["whatever"] });
      assertEquals(r.code, 42);
    } finally {
      await fx.cleanup();
    }
  },
);

Deno.test(
  "FR-E74 launcher forwards SIGTERM to child binary",
  async () => {
    if (Deno.build.os === "windows") return; // SIGTERM not on Windows
    const markerFile = await Deno.makeTempFile({ prefix: "marker-" });
    const readyFile = await Deno.makeTempFile({ prefix: "ready-" });
    await Deno.remove(markerFile); // expect the child to create it
    await Deno.remove(readyFile); // child signals readiness via this
    const stub = `#!/usr/bin/env bash
trap 'touch "${markerFile}"; exit 0' TERM
# Signal readiness so the test waits for the grandchild to spawn
# before sending SIGTERM — fixed-delay sleeps race Deno cold start.
touch "${readyFile}"
# Sleep in a loop so 'trap' has a chance to fire when SIGTERM arrives.
while true; do sleep 0.05; done
`;
    const fx = await setupIntFixture({
      version: "0.3.0",
      prePopulateBinary: true,
      stubBinaryBody: stub,
    });
    try {
      const env: Record<string, string> = {
        CLAUDE_PLUGIN_ROOT: fx.pluginRoot,
        CLAUDE_PLUGIN_DATA: fx.pluginData,
        PATH: `${fx.shimDir}:/usr/bin:/bin`,
        HOME: fx.pluginRoot,
      };
      const child = new Deno.Command(join(fx.shimDir, "deno"), {
        args: [
          "run",
          "-A",
          "--no-check",
          join(fx.pluginRoot, "bin", "launch.ts"),
          "long",
        ],
        env,
        clearEnv: true,
        stdout: "null",
        stderr: "null",
      }).spawn();
      // Wait until the grandchild has signalled readiness — fixed
      // delays race Deno cold start + module load on slow hosts.
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try {
          await Deno.stat(readyFile);
          ready = true;
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      assertEquals(ready, true, "grandchild never reached ready marker");
      child.kill("SIGTERM");
      const { code } = await child.status;
      // Marker file must exist within ~1s (child handled SIGTERM).
      let saw = false;
      for (let i = 0; i < 20; i++) {
        try {
          await Deno.stat(markerFile);
          saw = true;
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      assertEquals(
        saw,
        true,
        `marker not created; launcher likely failed to forward SIGTERM (exit=${code})`,
      );
    } finally {
      await fx.cleanup();
      for (const f of [markerFile, readyFile]) {
        try {
          await Deno.remove(f);
        } catch { /* may not exist */ }
      }
    }
  },
);
