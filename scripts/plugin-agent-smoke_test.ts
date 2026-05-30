import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import {
  parseAgentSmokeArgs,
  runPluginAgentSmoke,
} from "./plugin-agent-smoke.ts";
import type { SmokeCommandOutput } from "./plugin-install-smoke.ts";

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
  const payloadDir = await Deno.makeTempDir({ prefix: "plugin-agent-" });
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

Deno.test("real agent smoke — claude installs plugin and invokes get_workflow", async () => {
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

    const result = await runPluginAgentSmoke({
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
                "FLOWAI_AGENT_SMOKE_PASS host=claude",
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
      "claude: real agent smoke passed",
    );
  } finally {
    if (oldKey === undefined) Deno.env.delete("ANTHROPIC_API_KEY");
    else Deno.env.set("ANTHROPIC_API_KEY", oldKey);
  }
});

Deno.test("real agent smoke — codex logs in, installs plugin, and invokes get_workflow", async () => {
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

    const result = await runPluginAgentSmoke({
      payloadDir: roots.payloadDir,
      host: "codex",
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
        if (args[0] === "exec") {
          return Promise.resolve(
            ok(
              '{"type":"tool_call","name":"get_workflow"}\n' +
                "FLOWAI_AGENT_SMOKE_PASS host=codex",
            ),
          );
        }
        return Promise.resolve(ok());
      },
    });

    assertEquals(result.hosts[0].status, "passed");
    const loginCall = calls.find((call) => call.args[0] === "login");
    assertEquals(loginCall?.stdin, "test-openai-key\n");
    const execCall = calls.find((call) => call.args[0] === "exec");
    if (!execCall) throw new Error("missing codex exec call");
    assertEquals(execCall.command, "codex");
    assertStringIncludes(execCall.args.join(" "), "--json");
    assertStringIncludes(
      execCall.env.FLOWAI_WORKFLOW,
      "github-inbox-opencode-test",
    );
    assertStringIncludes(evidence.join("\n"), "stdin: <redacted>");
    assertStringIncludes(evidence.join("\n"), "codex: real agent smoke passed");
  } finally {
    if (oldKey === undefined) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", oldKey);
  }
});

Deno.test("real agent smoke — missing auth fails before host launch", async () => {
  const oldKey = Deno.env.get("ANTHROPIC_API_KEY");
  Deno.env.delete("ANTHROPIC_API_KEY");
  try {
    const roots = await fixturePayload();
    await assertRejects(
      () =>
        runPluginAgentSmoke({
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

Deno.test("real agent smoke — argument parser selects hosts and timeout", () => {
  const parsed = parseAgentSmokeArgs([
    "--payload-dir",
    "/tmp/payload",
    "--host",
    "all",
    "--timeout-ms",
    "1234",
  ]);
  if ("help" in parsed) throw new Error("unexpected help");
  assertEquals(parsed.payloadDir, "/tmp/payload");
  assertEquals(parsed.hosts, ["claude", "codex"]);
  assertEquals(parsed.timeoutMs, 1234);
});
