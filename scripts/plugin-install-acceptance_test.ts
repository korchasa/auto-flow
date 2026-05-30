import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { dirname, join } from "@std/path";
import {
  discoverInstalledPluginRoot,
  type InstallCommandOutput as AcceptanceCommandOutput,
  installPluginForHost,
  parseInstallAcceptanceArgs,
  probeInstalledMcp,
  resolveCommandHookPath,
  runHookAcceptance,
  runPluginInstallAcceptance,
} from "./plugin-install-acceptance.ts";

type CommandCall = {
  command: string;
  args: string[];
  env: Record<string, string>;
  stdin?: string;
  cwd?: string;
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

function ok(stdout = ""): AcceptanceCommandOutput {
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
  const payloadDir = await Deno.makeTempDir({
    prefix: "plugin-install-acceptance-",
  });
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
  await Deno.mkdir(
    join(codexRoot, ".flowai-workflow", "github-inbox-opencode-test"),
    {
      recursive: true,
    },
  );
  await Deno.mkdir(
    join(claudeRoot, ".flowai-workflow", "github-inbox-opencode-test"),
    {
      recursive: true,
    },
  );
  return { payloadDir, codexRoot, claudeRoot };
}

Deno.test("install acceptance — install probe installs official marketplace into isolated host home", async () => {
  const calls: CommandCall[] = [];
  const evidence: string[] = [];
  const roots = await fixturePayload();
  const installedRoot = await Deno.makeTempDir({
    prefix: "installed-codex-",
  });
  await Deno.mkdir(join(installedRoot, ".codex-plugin"), { recursive: true });
  await Deno.copyFile(
    join(roots.codexRoot, ".mcp.json"),
    join(installedRoot, ".mcp.json"),
  );

  const result = await installPluginForHost({
    host: "codex",
    payloadDir: roots.payloadDir,
    makeTempDir: async () =>
      await Deno.makeTempDir({ prefix: "acceptance-home-" }),
    reporter: (line) => evidence.push(line),
    probeMcp: () =>
      Promise.resolve({
        serverName: "flowai-workflow",
        tools: expectedTools,
      }),
    runCommand: (command, args, opts) => {
      calls.push({ command, args, env: opts.env, cwd: opts.cwd });
      if (args[0] === "--version") return Promise.resolve(ok("codex 0.135.0"));
      if (args[0] === "plugin" && args[1] === "add") {
        return Promise.resolve(ok(`installed at ${installedRoot}`));
      }
      return Promise.resolve(ok());
    },
  });

  assertEquals(result.status, "passed");
  assertEquals(calls.map((call) => [call.command, ...call.args]), [
    ["codex", "--version"],
    ["codex", "plugin", "marketplace", "add", join(roots.payloadDir, "codex")],
    ["codex", "plugin", "add", "flowai-workflow@flowai-workflow"],
  ]);
  assertStringIncludes(calls[0].env.HOME, "acceptance-home-");
  assertStringIncludes(calls[0].env.CODEX_HOME, "acceptance-home-");

  const log = evidence.join("\n");
  assertStringIncludes(log, "codex: reading MCP config");
  assertStringIncludes(log, "codex: MCP check: initialize over stdio");
  assertStringIncludes(log, "codex: MCP tool check passed");
  assertStringIncludes(log, "codex: install probe passed with");
});

Deno.test("install acceptance — missing host CLI fails clearly", async () => {
  const roots = await fixturePayload();
  await assertRejects(
    () =>
      installPluginForHost({
        host: "codex",
        payloadDir: roots.payloadDir,
        runCommand: () => Promise.reject(new Deno.errors.NotFound("codex")),
      }),
    Error,
    "required host CLI `codex` was not found",
  );
});

Deno.test("install acceptance — installed plugin root discovery rejects ambiguous cache", async () => {
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

Deno.test("install acceptance — installed MCP config completes initialize and tools list", async () => {
  const roots = await fixturePayload();
  const seen: Array<
    {
      command: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
    }
  > = [];

  const codex = await probeInstalledMcp({
    host: "codex",
    pluginRoot: roots.codexRoot,
    pluginDataDir: join(roots.payloadDir, "data", "codex"),
    probeMcp: (request) => {
      seen.push(request);
      return Promise.resolve({
        serverName: "flowai-workflow",
        tools: expectedTools,
      });
    },
  });
  assertEquals(codex.serverName, "flowai-workflow");
  assertEquals(seen[0].command, "deno");
  assertEquals(seen[0].args, ["run", "-A", "./bin/launch.ts", "mcp"]);
  assertEquals(seen[0].cwd, roots.codexRoot);
  assertEquals(seen[0].env.FLOWAI_SUPPRESS_DEPRECATION, "1");
  assertEquals(seen[0].env.PLUGIN_ROOT, roots.codexRoot);

  await probeInstalledMcp({
    host: "claude",
    pluginRoot: roots.claudeRoot,
    pluginDataDir: join(roots.payloadDir, "data", "claude"),
    probeMcp: (request) => {
      seen.push(request);
      return Promise.resolve({
        serverName: "flowai-workflow",
        tools: expectedTools,
      });
    },
  });
  assertEquals(seen[1].args, [
    "run",
    "-A",
    join(roots.claudeRoot, "bin", "launch.ts"),
    "mcp",
  ]);
  assertEquals(seen[1].cwd, roots.claudeRoot);
  assertEquals(seen[1].env.CLAUDE_PLUGIN_ROOT, roots.claudeRoot);
});

Deno.test("install acceptance — hook commands are validated and executed", async () => {
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

  await runHookAcceptance({
    host: "codex",
    pluginRoot: roots.codexRoot,
    pluginDataDir: join(roots.payloadDir, "data"),
    runCommand: (command, args, opts) => {
      calls.push({ command, args, env: opts.env, cwd: opts.cwd });
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

Deno.test("install acceptance — missing hook declaration is accepted explicitly", async () => {
  const roots = await fixturePayload();
  const result = await runHookAcceptance({
    host: "claude",
    pluginRoot: roots.claudeRoot,
    pluginDataDir: join(roots.payloadDir, "data"),
    runCommand: () => Promise.reject(new Error("hook command should not run")),
  });
  assertEquals(result.status, "no hooks declared");
});

Deno.test("install acceptance — claude installs plugin and invokes get_workflow", async () => {
  const oldKey = Deno.env.get("ANTHROPIC_API_KEY");
  Deno.env.set("ANTHROPIC_API_KEY", "test-anthropic-key");
  try {
    const calls: CommandCall[] = [];
    const evidence: string[] = [];
    const roots = await fixturePayload();
    const installedRoot = await Deno.makeTempDir({
      prefix: "installed-claude-agent-",
    });
    await writeJson(join(installedRoot, ".claude-plugin", "plugin.json"), {
      name: "flowai-workflow",
    });
    await Deno.copyFile(
      join(roots.claudeRoot, ".mcp.json"),
      join(installedRoot, ".mcp.json"),
    );

    const result = await runPluginInstallAcceptance({
      payloadDir: roots.payloadDir,
      host: "claude",
      timeoutMs: 1_000,
      reporter: (line) => evidence.push(line),
      makeTempDir: async () =>
        await Deno.makeTempDir({ prefix: "agent-home-" }),
      probeMcp: () =>
        Promise.resolve({
          serverName: "flowai-workflow",
          tools: expectedTools,
        }),
      runCommand: (command, args, opts) => {
        calls.push({ command, args, env: opts.env, cwd: opts.cwd });
        if (args[0] === "--version") return Promise.resolve(ok("2.1.158"));
        if (args[0] === "plugin" && args[1] === "install") {
          return Promise.resolve(ok(`installed at ${installedRoot}`));
        }
        if (args.includes("--plugin-dir")) {
          return Promise.resolve(
            ok(
              '{"type":"tool_use","name":"mcp__flowai-workflow__get_workflow"}\n' +
                "FLOWAI_INSTALL_ACCEPTANCE_PASS host=claude",
            ),
          );
        }
        return Promise.resolve(ok());
      },
    });

    assertEquals(result.hosts[0].status, "passed");
    const agentCall = calls.find((call) => call.args.includes("--plugin-dir"));
    if (!agentCall) throw new Error("missing claude agent call");
    assertEquals(agentCall.command, "claude");
    assertStringIncludes(agentCall.args.join(" "), "--allowedTools");
    assertStringIncludes(
      agentCall.args.join(" "),
      "mcp__flowai-workflow__get_workflow",
    );
    assertStringIncludes(
      agentCall.env.FLOWAI_WORKFLOW,
      "github-inbox-opencode-test",
    );
    assertStringIncludes(
      evidence.join("\n"),
      "claude: install acceptance passed",
    );
  } finally {
    if (oldKey === undefined) Deno.env.delete("ANTHROPIC_API_KEY");
    else Deno.env.set("ANTHROPIC_API_KEY", oldKey);
  }
});

Deno.test("install acceptance — codex openai logs in, installs plugin, and invokes get_workflow", async () => {
  const oldKey = Deno.env.get("OPENAI_API_KEY");
  Deno.env.set("OPENAI_API_KEY", "test-openai-key");
  try {
    const calls: CommandCall[] = [];
    const evidence: string[] = [];
    const roots = await fixturePayload();
    const installedRoot = await Deno.makeTempDir({
      prefix: "installed-codex-agent-",
    });
    await writeJson(join(installedRoot, ".codex-plugin", "plugin.json"), {
      name: "flowai-workflow",
    });
    await Deno.copyFile(
      join(roots.codexRoot, ".mcp.json"),
      join(installedRoot, ".mcp.json"),
    );

    const result = await runPluginInstallAcceptance({
      payloadDir: roots.payloadDir,
      host: "codex",
      codexProvider: "openai",
      timeoutMs: 1_000,
      reporter: (line) => evidence.push(line),
      makeTempDir: async () =>
        await Deno.makeTempDir({ prefix: "agent-home-" }),
      probeMcp: () =>
        Promise.resolve({
          serverName: "flowai-workflow",
          tools: expectedTools,
        }),
      runCommand: (command, args, opts) => {
        calls.push({
          command,
          args,
          env: opts.env,
          stdin: opts.stdin,
          cwd: opts.cwd,
        });
        if (args[0] === "--version") {
          return Promise.resolve(ok("codex 0.135.0"));
        }
        if (args[0] === "plugin" && args[1] === "add") {
          return Promise.resolve(ok(`Installed plugin root: ${installedRoot}`));
        }
        if (args[0] === "login") return Promise.resolve(ok("logged in"));
        if (args.includes("exec")) {
          return Promise.resolve(
            ok(
              '{"type":"item.completed","item":{"type":"mcp_tool_call","server":"flowai-workflow","tool":"get_workflow","error":null,"status":"completed"}}\n' +
                "FLOWAI_INSTALL_ACCEPTANCE_PASS host=codex",
            ),
          );
        }
        return Promise.resolve(ok());
      },
    });

    assertEquals(result.hosts[0].status, "passed");
    const loginCall = calls.find((call) => call.args[0] === "login");
    assertEquals(loginCall?.stdin, "test-openai-key\n");
    const execCall = calls.find((call) => call.args.includes("exec"));
    if (!execCall) throw new Error("missing codex exec call");
    assertEquals(execCall.command, "codex");
    assertEquals(
      execCall.args[0],
      "--dangerously-bypass-approvals-and-sandbox",
    );
    assertStringIncludes(execCall.args.join(" "), "--json");
    assertStringIncludes(execCall.args.join(" "), "--skip-git-repo-check");
    assertStringIncludes(
      execCall.env.FLOWAI_WORKFLOW,
      "github-inbox-opencode-test",
    );
    assertStringIncludes(evidence.join("\n"), "stdin: <redacted>");
    assertStringIncludes(
      evidence.join("\n"),
      "codex: install acceptance passed",
    );
  } finally {
    if (oldKey === undefined) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", oldKey);
  }
});

Deno.test("install acceptance — codex openrouter uses provider config without login", async () => {
  const oldKey = Deno.env.get("OPENROUTER_API_KEY");
  const oldModel = Deno.env.get("CODEX_INSTALL_ACCEPTANCE_MODEL");
  Deno.env.set("OPENROUTER_API_KEY", "test-openrouter-key");
  Deno.env.set("CODEX_INSTALL_ACCEPTANCE_MODEL", "openai/gpt-4.1");
  try {
    const calls: CommandCall[] = [];
    const roots = await fixturePayload();
    const installedRoot = await Deno.makeTempDir({
      prefix: "installed-codex-agent-",
    });
    await writeJson(join(installedRoot, ".codex-plugin", "plugin.json"), {
      name: "flowai-workflow",
    });
    await Deno.copyFile(
      join(roots.codexRoot, ".mcp.json"),
      join(installedRoot, ".mcp.json"),
    );

    await runPluginInstallAcceptance({
      payloadDir: roots.payloadDir,
      host: "codex",
      codexProvider: "openrouter",
      timeoutMs: 1_000,
      makeTempDir: async () =>
        await Deno.makeTempDir({ prefix: "agent-home-" }),
      probeMcp: () =>
        Promise.resolve({
          serverName: "flowai-workflow",
          tools: expectedTools,
        }),
      runCommand: (command, args, opts) => {
        calls.push({
          command,
          args,
          env: opts.env,
          stdin: opts.stdin,
          cwd: opts.cwd,
        });
        if (args[0] === "--version") {
          return Promise.resolve(ok("codex 0.135.0"));
        }
        if (args[0] === "plugin" && args[1] === "add") {
          return Promise.resolve(ok(`Installed plugin root: ${installedRoot}`));
        }
        if (args.includes("exec")) {
          return Promise.resolve(
            ok(
              '{"type":"item.completed","item":{"type":"mcp_tool_call","server":"flowai-workflow","tool":"get_workflow","error":null,"status":"completed"}}\n' +
                "FLOWAI_INSTALL_ACCEPTANCE_PASS host=codex",
            ),
          );
        }
        return Promise.resolve(ok());
      },
    });

    const loginCall = calls.find((call) => call.args[0] === "login");
    assertEquals(loginCall, undefined);
    const execCall = calls.find((call) => call.args.includes("exec"));
    if (!execCall) throw new Error("missing codex exec call");
    assertEquals(execCall.command, "codex");
    assertStringIncludes(execCall.args.join(" "), "--skip-git-repo-check");
    assertStringIncludes(
      execCall.args.join(" "),
      'model_provider="openrouter"',
    );
    assertStringIncludes(execCall.args.join(" "), 'model="openai/gpt-4.1"');
    assertStringIncludes(
      execCall.args.join(" "),
      'model_providers.openrouter.env_key="OPENROUTER_API_KEY"',
    );
  } finally {
    if (oldKey === undefined) Deno.env.delete("OPENROUTER_API_KEY");
    else Deno.env.set("OPENROUTER_API_KEY", oldKey);
    if (oldModel === undefined) {
      Deno.env.delete("CODEX_INSTALL_ACCEPTANCE_MODEL");
    } else Deno.env.set("CODEX_INSTALL_ACCEPTANCE_MODEL", oldModel);
  }
});

Deno.test("install acceptance — codex command execution is not MCP tool evidence", async () => {
  const oldKey = Deno.env.get("OPENROUTER_API_KEY");
  const oldModel = Deno.env.get("CODEX_INSTALL_ACCEPTANCE_MODEL");
  Deno.env.set("OPENROUTER_API_KEY", "test-openrouter-key");
  Deno.env.set("CODEX_INSTALL_ACCEPTANCE_MODEL", "openai/gpt-4.1");
  try {
    const roots = await fixturePayload();
    const installedRoot = await Deno.makeTempDir({
      prefix: "installed-codex-agent-",
    });
    await writeJson(join(installedRoot, ".codex-plugin", "plugin.json"), {
      name: "flowai-workflow",
    });
    await Deno.copyFile(
      join(roots.codexRoot, ".mcp.json"),
      join(installedRoot, ".mcp.json"),
    );

    await assertRejects(
      () =>
        runPluginInstallAcceptance({
          payloadDir: roots.payloadDir,
          host: "codex",
          codexProvider: "openrouter",
          timeoutMs: 1_000,
          makeTempDir: async () =>
            await Deno.makeTempDir({ prefix: "agent-home-" }),
          probeMcp: () =>
            Promise.resolve({
              serverName: "flowai-workflow",
              tools: expectedTools,
            }),
          runCommand: (_command, args) => {
            if (args[0] === "--version") {
              return Promise.resolve(ok("codex 0.135.0"));
            }
            if (args[0] === "plugin" && args[1] === "add") {
              return Promise.resolve(
                ok(`Installed plugin root: ${installedRoot}`),
              );
            }
            if (args.includes("exec")) {
              return Promise.resolve(
                ok(
                  '{"type":"item.completed","item":{"type":"command_execution","command":"flowai-workflow get_workflow"}}\n' +
                    "FLOWAI_INSTALL_ACCEPTANCE_PASS host=codex",
                ),
              );
            }
            return Promise.resolve(ok());
          },
        }),
      Error,
      "install acceptance did not show get_workflow tool evidence",
    );
  } finally {
    if (oldKey === undefined) Deno.env.delete("OPENROUTER_API_KEY");
    else Deno.env.set("OPENROUTER_API_KEY", oldKey);
    if (oldModel === undefined) {
      Deno.env.delete("CODEX_INSTALL_ACCEPTANCE_MODEL");
    } else Deno.env.set("CODEX_INSTALL_ACCEPTANCE_MODEL", oldModel);
  }
});

Deno.test("install acceptance — missing auth fails before host launch", async () => {
  const oldKey = Deno.env.get("ANTHROPIC_API_KEY");
  Deno.env.delete("ANTHROPIC_API_KEY");
  try {
    const roots = await fixturePayload();
    await assertRejects(
      () =>
        runPluginInstallAcceptance({
          payloadDir: roots.payloadDir,
          host: "claude",
          runCommand: () => Promise.reject(new Error("should not run")),
        }),
      Error,
      "Missing required environment variable ANTHROPIC_API_KEY",
    );
  } finally {
    if (oldKey !== undefined) Deno.env.set("ANTHROPIC_API_KEY", oldKey);
  }
});

Deno.test("install acceptance — codex requires explicit provider", async () => {
  const roots = await fixturePayload();
  await assertRejects(
    () =>
      runPluginInstallAcceptance({
        payloadDir: roots.payloadDir,
        host: "codex",
        runCommand: () => Promise.reject(new Error("should not run")),
      }),
    Error,
    "Codex install acceptance requires --codex-provider openai|openrouter.",
  );
});

Deno.test("install acceptance — argument parser selects hosts, provider, and timeout", () => {
  const parsed = parseInstallAcceptanceArgs([
    "--payload-dir",
    "/tmp/payload",
    "--host",
    "all",
    "--codex-provider",
    "openrouter",
    "--timeout-ms",
    "1234",
  ]);
  if ("help" in parsed) throw new Error("unexpected help");
  assertEquals(parsed.payloadDir, "/tmp/payload");
  assertEquals(parsed.hosts, ["claude", "codex"]);
  assertEquals(parsed.codexProvider, "openrouter");
  assertEquals(parsed.timeoutMs, 1234);
});
