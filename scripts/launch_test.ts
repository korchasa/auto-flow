/**
 * Tests for the plugin launcher script
 * (`claude-plugin/plugins/flowai-workflow/bin/launch.sh`, FR-E74).
 *
 * Strategy: each test sets up an isolated temp `CLAUDE_PLUGIN_ROOT` +
 * `CLAUDE_PLUGIN_DATA` fixture, places a fake `deno` shim early on PATH
 * (logs invocations and synthesises a stub binary at `--output`), then
 * runs the real `bash launch.sh ...` and asserts on the fake-deno log
 * + on what arguments the stub binary received via its own log file.
 *
 * The stub binary is a tiny bash script (chmod 0755) that writes its
 * argv to a log file the test reads. This isolates the launcher's
 * compile/cache/resolve logic from the actual `deno compile` cost,
 * which is exercised end-to-end in the manual smoke step.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join, resolve } from "@std/path";

const LAUNCHER_SRC = resolve(
  "claude-plugin/plugins/flowai-workflow/bin/launch.sh",
);

interface Fixture {
  pluginRoot: string;
  pluginData: string;
  projectRoot: string;
  shimDir: string;
  cleanup: () => Promise<void>;
  /** Read the fake-deno invocation log; one line per compile call. */
  readDenoLog: () => Promise<string[]>;
  /** Read the stub-binary invocation log; one line of JSON per call. */
  readBinaryLog: () => Promise<unknown[]>;
}

interface FixtureOpts {
  /** Plugin version (written into the fixture plugin.json). */
  version?: string;
  /** Pre-populate the cached binary so the launcher skips compile. */
  prePopulateBinary?: boolean;
  /** Provide a `deno` shim on PATH (default: true). */
  withDeno?: boolean;
  /** Files to create under `<projectRoot>/.flowai-workflow/...`.
   * Map: relative path → file content. */
  projectWorkflows?: Record<string, string>;
}

async function setupFixture(opts: FixtureOpts = {}): Promise<Fixture> {
  const version = opts.version ?? "9.9.9";
  const tmp = await Deno.makeTempDir({ prefix: "launch-test-" });
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

  // Real launcher copied verbatim from source-of-truth.
  const launcherText = await Deno.readTextFile(LAUNCHER_SRC);
  const launcherPath = join(pluginRoot, "bin", "launch.sh");
  await Deno.writeTextFile(launcherPath, launcherText);
  await Deno.chmod(launcherPath, 0o755);

  // Stub plugin.json with version.
  await Deno.writeTextFile(
    join(pluginRoot, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "flowai-workflow", version }, null, 2),
  );
  // Stub engine entry so the launcher has *something* to point deno at
  // (though the fake-deno shim never reads it).
  await Deno.writeTextFile(
    join(pluginRoot, "engine", "cli.ts"),
    "console.log('stub')\n",
  );

  // Project workflows.
  for (
    const [rel, content] of Object.entries(opts.projectWorkflows ?? {})
  ) {
    const p = join(projectRoot, rel);
    await Deno.mkdir(join(p, "..").replace(/\/\.\.$/, ""), {
      recursive: true,
    });
    // mkdir -p the parent of the file
    const parent = p.substring(0, p.lastIndexOf("/"));
    await Deno.mkdir(parent, { recursive: true });
    await Deno.writeTextFile(p, content);
  }

  const denoLog = join(tmp, "deno-invocations.log");
  const binLog = join(tmp, "binary-invocations.log");

  if (opts.withDeno !== false) {
    // Fake `deno` shim: log invocation + materialise a stub binary at
    // the `--output` arg so the launcher's mv-then-exec path works.
    const stubBin = `#!/usr/bin/env bash
set -e
# Log launcher's "deno compile" invocation (one line, args separated by U+001F).
python3 -c 'import sys; print("\\x1f".join(sys.argv[1:]))' "$@" >> "${denoLog}"
# Find --output target; write the stub binary there.
out=""
prev=""
for a in "$@"; do
  if [[ "$prev" == "--output" ]]; then out="$a"; fi
  prev="$a"
done
if [[ -n "$out" ]]; then
  cat > "$out" <<'STUBEOF'
#!/usr/bin/env bash
exec python3 -c 'import sys,json; open("${binLog}","a").write(json.dumps(sys.argv[1:])+"\\n")' "$@"
STUBEOF
  # Substitute the binLog path into the stub.
  sed -i.bak "s|\\\${binLog}|${binLog}|g" "$out"
  rm -f "$out.bak"
  chmod +x "$out"
fi
`;
    await Deno.writeTextFile(join(shimDir, "deno"), stubBin);
    await Deno.chmod(join(shimDir, "deno"), 0o755);
  }

  if (opts.prePopulateBinary) {
    const cachedBin = join(
      pluginData,
      "bin",
      `flowai-workflow-${version}`,
    );
    await Deno.mkdir(join(pluginData, "bin"), { recursive: true });
    const stub = `#!/usr/bin/env bash
exec python3 -c 'import sys,json; open("${binLog}","a").write(json.dumps(sys.argv[1:])+"\\n")' "$@"
`;
    await Deno.writeTextFile(cachedBin, stub);
    await Deno.chmod(cachedBin, 0o755);
  }

  return {
    pluginRoot,
    pluginData,
    projectRoot,
    shimDir,
    cleanup: async () => {
      await Deno.remove(tmp, { recursive: true });
    },
    readDenoLog: async () => {
      try {
        const txt = await Deno.readTextFile(denoLog);
        // Stub shim joins argv with U+001F so we can split cleanly.
        return txt.split("\n").filter((s) => s.length > 0);
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) return [];
        throw e;
      }
    },
    readBinaryLog: async () => {
      try {
        const txt = await Deno.readTextFile(binLog);
        return txt.split("\n")
          .filter((s) => s.length > 0)
          .map((line) => JSON.parse(line));
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) return [];
        throw e;
      }
    },
  };
}

interface RunOpts {
  args: string[];
  env?: Record<string, string>;
  /** Override the launcher's PATH; default: shim + /usr/bin:/bin. */
  pathOverride?: string;
  fx: Fixture;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runLauncher(opts: RunOpts): Promise<RunResult> {
  const baseEnv: Record<string, string> = {
    CLAUDE_PLUGIN_ROOT: opts.fx.pluginRoot,
    CLAUDE_PLUGIN_DATA: opts.fx.pluginData,
    PATH: opts.pathOverride ?? `${opts.fx.shimDir}:/usr/bin:/bin`,
    HOME: opts.fx.pluginRoot, // isolate from real $HOME for python3 etc.
    ...opts.env,
  };
  const cmd = new Deno.Command("bash", {
    args: [
      join(opts.fx.pluginRoot, "bin", "launch.sh"),
      ...opts.args,
    ],
    env: baseEnv,
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

Deno.test(
  "FR-E74 launcher compiles on first call and caches by version",
  async () => {
    const fx = await setupFixture({ version: "1.2.3" });
    try {
      const r1 = await runLauncher({ fx, args: ["--version"] });
      assertEquals(r1.code, 0, `first run stderr: ${r1.stderr}`);
      const r2 = await runLauncher({ fx, args: ["--version"] });
      assertEquals(r2.code, 0);
      const denoLog = await fx.readDenoLog();
      assertEquals(
        denoLog.length,
        1,
        `expected exactly one deno compile call, got ${denoLog.length}: ${
          denoLog.join(" | ")
        }`,
      );
      // Cached binary exists at the versioned path.
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
  "FR-E74 launcher fails fast without Deno when binary is missing",
  async () => {
    const fx = await setupFixture({ withDeno: false });
    try {
      const r = await runLauncher({
        fx,
        args: ["--version"],
        pathOverride: "/usr/bin:/bin", // no shim, no real deno
      });
      assertEquals(r.code, 127);
      assertStringIncludes(r.stderr, "Deno 2.x is required");
      assertStringIncludes(r.stderr, "https://deno.com/");
    } finally {
      await fx.cleanup();
    }
  },
);

Deno.test(
  "FR-E74 launcher skips Deno preflight when binary cached",
  async () => {
    const fx = await setupFixture({
      version: "2.0.0",
      prePopulateBinary: true,
      withDeno: false,
    });
    try {
      const r = await runLauncher({
        fx,
        args: ["--help"],
        pathOverride: "/usr/bin:/bin", // no deno on PATH
      });
      assertEquals(r.code, 0, `stderr: ${r.stderr}`);
      // Binary received "--help".
      const binLog = await fx.readBinaryLog();
      assertEquals(binLog.length, 1);
      assertEquals(binLog[0], ["--help"]);
    } finally {
      await fx.cleanup();
    }
  },
);

Deno.test(
  "FR-E74 launcher resolves single workflow folder for mcp",
  async () => {
    const fx = await setupFixture({
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
      const binLog = await fx.readBinaryLog();
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
  "FR-E74 launcher prefers github-inbox on ambiguity",
  async () => {
    const fx = await setupFixture({
      version: "0.1.0",
      prePopulateBinary: true,
      projectWorkflows: {
        ".flowai-workflow/github-inbox/workflow.yaml": "nodes: []\n",
        ".flowai-workflow/other/workflow.yaml": "nodes: []\n",
      },
    });
    try {
      const r = await runLauncher({
        fx,
        args: ["mcp"],
        env: { CLAUDE_PROJECT_DIR: fx.projectRoot },
      });
      assertEquals(r.code, 0, `stderr: ${r.stderr}`);
      const binLog = await fx.readBinaryLog();
      const argv = binLog[0] as string[];
      assertEquals(argv[0], "mcp");
      assertStringIncludes(argv[1], "/github-inbox");
    } finally {
      await fx.cleanup();
    }
  },
);

Deno.test(
  "FR-E74 launcher passes --no-workflow when none found",
  async () => {
    const fx = await setupFixture({
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
      const binLog = await fx.readBinaryLog();
      assertEquals(binLog[0], ["mcp", "--no-workflow"]);
    } finally {
      await fx.cleanup();
    }
  },
);

Deno.test(
  "FR-E74 launcher honours FLOWAI_WORKFLOW override",
  async () => {
    const fx = await setupFixture({
      version: "0.1.0",
      prePopulateBinary: true,
    });
    try {
      const r = await runLauncher({
        fx,
        args: ["mcp"],
        env: {
          CLAUDE_PROJECT_DIR: fx.projectRoot,
          FLOWAI_WORKFLOW: "/explicit/path",
        },
      });
      assertEquals(r.code, 0, `stderr: ${r.stderr}`);
      const binLog = await fx.readBinaryLog();
      assertEquals(binLog[0], ["mcp", "/explicit/path"]);
    } finally {
      await fx.cleanup();
    }
  },
);
