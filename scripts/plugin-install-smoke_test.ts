import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { dirname, join } from "@std/path";
import {
  discoverInstalledPluginRoot,
  type HostKind,
  installPluginForHost,
  OFFICIAL_MARKETPLACE_NAME,
  parseInstallSmokeArgs,
  probeInstalledMcp,
  resolveCommandHookPath,
  runHookSmoke,
  runPluginInstallSmoke,
  type SmokeCommandOutput,
} from "./plugin-install-smoke.ts";

type CommandCall = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

const expectedTools = [
  "apply_workflow_patch",
  "cancel_run",
  "get_state",
  "get_workflow",
  "list_runs",
  "resume_node",
  "tail_artifacts",
];

function ok(stdout = ""): SmokeCommandOutput {
  return { success: true, code: 0, stdout, stderr: "" };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(value, null, 2));
}

async function fixturePayload(): Promise<{
  payloadDir: string;
  codexRoot: string;
  claudeRoot: string;
}> {
  const payloadDir = await Deno.makeTempDir({ prefix: "plugin-install-" });
  const codexRoot = join(payloadDir, "codex", "plugins", "flowai-workflow");
  const claudeRoot = join(payloadDir, "claude", "plugins", "flowai-workflow");
  await writeJson(
    join(payloadDir, "codex", ".agents", "plugins", "marketplace.json"),
    {
      name: "flowai-workflow",
      plugins: [{
        name: "flowai-workflow",
        source: { source: "local", path: "./plugins/flowai-workflow" },
        version: "1.2.3",
      }],
    },
  );
  await writeJson(
    join(payloadDir, "claude", ".claude-plugin", "marketplace.json"),
    {
      name: "flowai-workflow",
      plugins: [{
        name: "flowai-workflow",
        source: "./plugins/flowai-workflow",
        version: "1.2.3",
      }],
    },
  );
  await writeJson(join(codexRoot, ".codex-plugin", "plugin.json"), {
    name: "flowai-workflow",
    version: "1.2.3",
    mcpServers: "./.mcp.json",
  });
  await writeJson(join(claudeRoot, ".claude-plugin", "plugin.json"), {
    name: "flowai-workflow",
    version: "1.2.3",
  });
  await writeJson(join(codexRoot, ".mcp.json"), {
    "flowai-workflow": {
      command: "deno",
      args: ["run", "-A", "./bin/launch.ts", "mcp"],
      cwd: ".",
      env: { FLOWAI_SUPPRESS_DEPRECATION: "1" },
    },
  });
  await writeJson(join(claudeRoot, ".mcp.json"), {
    mcpServers: {
      "flowai-workflow": {
        command: "deno",
        args: [
          "run",
          "-A",
          "${CLAUDE_PLUGIN_ROOT}/bin/launch.ts",
          "mcp",
        ],
        env: { FLOWAI_SUPPRESS_DEPRECATION: "1" },
      },
    },
  });
  await Deno.mkdir(join(codexRoot, "bin"), { recursive: true });
  await Deno.mkdir(join(claudeRoot, "bin"), { recursive: true });
  await Deno.writeTextFile(join(codexRoot, "bin", "launch.ts"), "");
  await Deno.writeTextFile(join(claudeRoot, "bin", "launch.ts"), "");
  return { payloadDir, codexRoot, claudeRoot };
}

Deno.test("FR-E72 official payload installs from source repo into isolated host home", async () => {
  const calls: CommandCall[] = [];
  const evidence: string[] = [];
  const roots = await fixturePayload();
  const installedRoot = await Deno.makeTempDir({ prefix: "installed-codex-" });
  await Deno.mkdir(join(installedRoot, ".codex-plugin"), { recursive: true });
  await Deno.copyFile(
    join(roots.codexRoot, ".mcp.json"),
    join(installedRoot, ".mcp.json"),
  );

  const result = await runPluginInstallSmoke({
    engineRoot: "/engine",
    version: "1.2.3",
    host: "codex",
    skipHostCliInstall: false,
    buildPayload: (opts) => {
      assertEquals(opts.marketplaceName, OFFICIAL_MARKETPLACE_NAME);
      return Promise.resolve({ filesWritten: [], manifestsUpdated: [] });
    },
    payloadDir: roots.payloadDir,
    makeTempDir: async () => await Deno.makeTempDir({ prefix: "smoke-home-" }),
    reporter: (line) => evidence.push(line),
    probeMcp: () =>
      Promise.resolve({
        serverName: "flowai-workflow",
        tools: [
          "apply_workflow_patch",
          "cancel_run",
          "get_state",
          "get_workflow",
          "list_runs",
          "resume_node",
          "tail_artifacts",
        ],
      }),
    runCommand: (command, args, opts) => {
      calls.push({ command, args, env: opts.env });
      if (args[0] === "--version") return Promise.resolve(ok("codex 0.130.0"));
      if (args[0] === "plugin" && args[1] === "add") {
        return Promise.resolve(ok(`installed at ${installedRoot}`));
      }
      return Promise.resolve(ok());
    },
  });

  assertEquals(result.hosts[0].status, "passed");
  assertEquals(calls.map((call) => [call.command, ...call.args]), [
    ["codex", "--version"],
    ["codex", "plugin", "marketplace", "add", join(roots.payloadDir, "codex")],
    ["codex", "plugin", "add", "flowai-workflow@flowai-workflow"],
  ]);
  assertStringIncludes(calls[0].env.HOME, "smoke-home-");
  assertStringIncludes(calls[0].env.CODEX_HOME, "smoke-home-");

  const log = evidence.join("\n");
  assertStringIncludes(log, "payload: using existing directory");
  assertStringIncludes(log, "hosts under test: codex");
  assertStringIncludes(log, "$ codex --version");
  assertStringIncludes(
    log,
    `$ codex plugin marketplace add ${join(roots.payloadDir, "codex")}`,
  );
  assertStringIncludes(
    log,
    "$ codex plugin add flowai-workflow@flowai-workflow",
  );
  assertStringIncludes(log, "codex: reading MCP config");
  assertStringIncludes(
    log,
    "codex: MCP command: deno run -A ./bin/launch.ts mcp",
  );
  assertStringIncludes(log, "codex: MCP expected tools:");
  assertStringIncludes(log, "codex: MCP check: initialize over stdio");
  assertStringIncludes(log, "codex: MCP returned tools:");
  assertStringIncludes(log, "codex: MCP tool check passed");
  assertStringIncludes(log, "codex: smoke passed with");
});

Deno.test("FR-E71 codex install path calls marketplace add and plugin add with isolated host home", async () => {
  const calls: CommandCall[] = [];
  const roots = await fixturePayload();
  const installedRoot = await Deno.makeTempDir({ prefix: "installed-codex-" });
  await Deno.copyFile(
    join(roots.codexRoot, ".mcp.json"),
    join(installedRoot, ".mcp.json"),
  );

  await installPluginForHost({
    host: "codex",
    payloadDir: roots.payloadDir,
    allowMissingHostCli: false,
    skipHostCliInstall: false,
    probeMcp: () =>
      Promise.resolve({
        serverName: "flowai-workflow",
        tools: expectedTools,
      }),
    makeTempDir: async () => await Deno.makeTempDir({ prefix: "codex-home-" }),
    runCommand: (command, args, opts) => {
      calls.push({ command, args, env: opts.env });
      if (args[0] === "--version") return Promise.resolve(ok("codex 0.130.0"));
      if (args[0] === "plugin" && args[1] === "add") {
        return Promise.resolve(ok(`Plugin installed: ${installedRoot}`));
      }
      return Promise.resolve(ok());
    },
  });

  assertEquals(calls[1].args, [
    "plugin",
    "marketplace",
    "add",
    join(roots.payloadDir, "codex"),
  ]);
  assertEquals(calls[2].args, [
    "plugin",
    "add",
    "flowai-workflow@flowai-workflow",
  ]);
  assertStringIncludes(calls[2].env.CODEX_HOME, "codex-home-");
});

Deno.test("FR-E71 missing host CLI fails in CI mode and skips only with allow flag", async () => {
  const roots = await fixturePayload();
  const missing = () => Promise.reject(new Deno.errors.NotFound("codex"));

  await assertRejects(
    () =>
      installPluginForHost({
        host: "codex",
        payloadDir: roots.payloadDir,
        allowMissingHostCli: false,
        skipHostCliInstall: false,
        runCommand: missing,
      }),
    Error,
    "required host CLI `codex` was not found",
  );

  const skipped = await installPluginForHost({
    host: "codex",
    payloadDir: roots.payloadDir,
    allowMissingHostCli: true,
    skipHostCliInstall: false,
    runCommand: missing,
  });
  assertEquals(skipped.status, "skipped");
});

Deno.test("FR-E71 installed plugin root is discovered from host output and ambiguous cache candidates fail clearly", async () => {
  const home = await Deno.makeTempDir({ prefix: "plugin-root-home-" });
  const discovered = await Deno.makeTempDir({
    prefix: "plugin-root-installed-",
  });
  await writeJson(join(discovered, ".codex-plugin", "plugin.json"), {
    name: "flowai-workflow",
  });
  await writeJson(join(discovered, ".mcp.json"), {});

  assertEquals(
    await discoverInstalledPluginRoot({
      host: "codex",
      hostHome: home,
      installOutputs: [`installed at ${discovered}`],
    }),
    discovered,
  );

  const first = join(home, "a", "flowai-workflow");
  const second = join(home, "b", "flowai-workflow");
  await writeJson(join(first, ".codex-plugin", "plugin.json"), {});
  await writeJson(join(second, ".codex-plugin", "plugin.json"), {});
  await assertRejects(
    () =>
      discoverInstalledPluginRoot({
        host: "codex",
        hostHome: home,
        installOutputs: [],
      }),
    Error,
    "ambiguous installed flowai-workflow plugin roots",
  );
});

Deno.test("FR-E74 installed codex mcp config completes initialize and tools list", async () => {
  const roots = await fixturePayload();
  const seen: Array<
    {
      command: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
    }
  > = [];
  const result = await probeInstalledMcp({
    host: "codex",
    pluginRoot: roots.codexRoot,
    pluginDataDir: join(roots.payloadDir, "data", "codex"),
    probeMcp: (request) => {
      seen.push(request);
      return Promise.resolve({
        serverName: "flowai-workflow",
        tools: [
          "apply_workflow_patch",
          "cancel_run",
          "get_state",
          "get_workflow",
          "list_runs",
          "resume_node",
          "tail_artifacts",
        ],
      });
    },
  });
  assertEquals(result.serverName, "flowai-workflow");
  assertEquals(seen[0].command, "deno");
  assertEquals(seen[0].args, ["run", "-A", "./bin/launch.ts", "mcp"]);
  assertEquals(seen[0].cwd, roots.codexRoot);
  assertEquals(seen[0].env.FLOWAI_SUPPRESS_DEPRECATION, "1");
  assertEquals(seen[0].env.PLUGIN_ROOT, roots.codexRoot);
});

Deno.test("FR-E74 installed claude mcp config completes initialize and tools list", async () => {
  const roots = await fixturePayload();
  const seen: Array<
    { args: string[]; cwd: string; env: Record<string, string> }
  > = [];
  await probeInstalledMcp({
    host: "claude",
    pluginRoot: roots.claudeRoot,
    pluginDataDir: join(roots.payloadDir, "data", "claude"),
    probeMcp: (request) => {
      seen.push(request);
      return Promise.resolve({
        serverName: "flowai-workflow",
        tools: [
          "apply_workflow_patch",
          "cancel_run",
          "get_state",
          "get_workflow",
          "list_runs",
          "resume_node",
          "tail_artifacts",
        ],
      });
    },
  });
  assertEquals(seen[0].args, [
    "run",
    "-A",
    join(roots.claudeRoot, "bin", "launch.ts"),
    "mcp",
  ]);
  assertEquals(seen[0].cwd, roots.claudeRoot);
  assertEquals(seen[0].env.CLAUDE_PLUGIN_ROOT, roots.claudeRoot);
});

Deno.test("FR-E71 installed plugin hook smoke validates and executes bundled hook commands", async () => {
  const roots = await fixturePayload();
  const hookScript = join(roots.codexRoot, "hooks", "check.ts");
  await Deno.mkdir(dirname(hookScript), { recursive: true });
  await Deno.writeTextFile(hookScript, "console.log('ok');\n");
  await writeJson(join(roots.codexRoot, "hooks", "hooks.json"), {
    hooks: [{
      event: "SessionStart",
      command: "./hooks/check.ts",
    }],
  });
  const calls: CommandCall[] = [];

  await runHookSmoke({
    host: "codex",
    pluginRoot: roots.codexRoot,
    pluginDataDir: join(roots.payloadDir, "data"),
    runCommand: (command, args, opts) => {
      calls.push({ command, args, env: opts.env });
      return Promise.resolve(ok());
    },
  });

  assertEquals(calls[0].command, hookScript);
  assertEquals(calls[0].env.PLUGIN_ROOT, roots.codexRoot);
  assertEquals(calls[0].env.CLAUDE_PLUGIN_ROOT, roots.codexRoot);

  assertEquals(
    resolveCommandHookPath(roots.codexRoot, "./hooks/check.ts"),
    hookScript,
  );
  assertThrows(
    () => resolveCommandHookPath(roots.codexRoot, "../bad.ts"),
    Error,
    "escapes plugin root",
  );
});

Deno.test("FR-E71 hooks hooks.json absence is no hooks to validate", async () => {
  const roots = await fixturePayload();
  const result = await runHookSmoke({
    host: "claude",
    pluginRoot: roots.claudeRoot,
    pluginDataDir: join(roots.payloadDir, "data"),
    runCommand: () => Promise.reject(new Error("hook command should not run")),
  });
  assertEquals(result.status, "no hooks declared");
});

Deno.test("FR-E71 parseInstallSmokeArgs supports host and missing-cli policy", () => {
  const parsed = parseInstallSmokeArgs([
    "--payload-dir",
    "/tmp/payload",
    "--host",
    "all",
    "--allow-missing-host-cli",
  ]);
  if ("help" in parsed) throw new Error("unexpected help");
  assertEquals(parsed.payloadDir, "/tmp/payload");
  assertEquals(parsed.hosts, ["claude", "codex"] as HostKind[]);
  assertEquals(parsed.allowMissingHostCli, true);
});
