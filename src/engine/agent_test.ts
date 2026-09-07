import { assertEquals, assertRejects } from "@std/assert";
import { resolve } from "@std/path";
import { type AgentRunOptions, runAgent } from "./agent.ts";
import { OutputManager } from "../output.ts";
import type {
  NodeConfig,
  ResolvedNodeSettings,
  TemplateContext,
  ValidationRule,
} from "../types.ts";
import type { ValidationResult } from "../config/validate.ts";
import type { RuntimeAdapter } from "@korchasa/ai-ide-cli/runtime/types";

// Note: Full integration tests for runAgent require a real claude CLI.
// These tests verify the module's helpers and data structures.
// Integration tests will be added when running with claude CLI available.

function makeSettings(): ResolvedNodeSettings {
  return {
    max_continuations: 3,
    timeout_seconds: 1800,
    on_error: "fail",
    max_retries: 3,
    retry_delay_seconds: 5,
  };
}

function makeCtx(): TemplateContext {
  return {
    node_dir: "/tmp/test-node",
    run_dir: "/tmp/test-run",
    run_id: "test-run",
    workDir: ".",
    args: { issue: "42" },
    env: {},
    input: {},
  };
}

Deno.test("AgentRunOptions — type structure with OutputManager", () => {
  const node: NodeConfig = {
    type: "agent",
    label: "Test agent",
    agent: "agent-developer",
    prompt: "Do task for issue #{{args.issue}}",
    validate: [
      { type: "file_exists", path: "{{node_dir}}/output.md" },
    ],
    before: "echo before",
    after: "echo after",
  };

  const output = new OutputManager("verbose");
  const opts: AgentRunOptions = {
    node,
    ctx: makeCtx(),
    settings: makeSettings(),
    output,
    nodeId: "developer",
  };

  assertEquals(opts.node.type, "agent");
  assertEquals(opts.settings.max_continuations, 3);
  assertEquals(opts.output instanceof OutputManager, true);
  assertEquals(opts.nodeId, "developer");
});

Deno.test("AgentRunOptions — output and nodeId are optional", () => {
  const node: NodeConfig = {
    type: "agent",
    label: "Test",
    prompt: "Do something",
  };

  const opts: AgentRunOptions = {
    node,
    ctx: makeCtx(),
    settings: makeSettings(),
  };

  assertEquals(opts.output, undefined);
  assertEquals(opts.nodeId, undefined);
});

Deno.test("AgentRunOptions — prompt interpolation structure", () => {
  const node: NodeConfig = {
    type: "agent",
    label: "Test",
    prompt:
      "Read {{input.spec}}/spec.md and implement changes. Output to {{node_dir}}/",
  };

  const ctx: TemplateContext = {
    ...makeCtx(),
    input: { spec: "/runs/test/spec" },
  };

  const opts: AgentRunOptions = {
    node,
    ctx,
    settings: makeSettings(),
  };

  assertEquals(opts.node.prompt!.includes("{{input.spec}}"), true);
  assertEquals(opts.ctx.input.spec, "/runs/test/spec");
});

Deno.test("AgentRunOptions — loop context available", () => {
  const ctx: TemplateContext = {
    ...makeCtx(),
    loop: { iteration: 2 },
  };

  assertEquals(ctx.loop!.iteration, 2);
});

function fakeAdapter(
  seen: Record<string, unknown>[],
  id: "claude" | "opencode" | "codex" = "claude",
): RuntimeAdapter {
  return {
    id,
    capabilities: {
      permissionMode: id === "claude",
      transcript: true,
      interactive: false,
      toolUseObservation: true,
      session: false,
      capabilityInventory: false,
      commandsFastChannel: false,
      toolFilter: id === "claude",
      reasoningEffort: id === "claude",
      mcpInjection: false,
      sessionFidelity: "native",
    },
    invoke(opts) {
      seen.push(opts as unknown as Record<string, unknown>);
      return Promise.resolve({
        output: {
          result: "ok",
          session_id: "session-1",
          duration_ms: 1,
          num_turns: 1,
          is_error: false,
        },
      });
    },
    launchInteractive() {
      throw new Error("not used");
    },
  };
}

Deno.test("runAgent writes interpolated system prompt artifact", async () => {
  const dir = await Deno.makeTempDir();
  const seen: Record<string, unknown>[] = [];
  const adapter = fakeAdapter(seen);
  const ctx: TemplateContext = {
    ...makeCtx(),
    node_dir: "runs/test-node",
    workDir: dir,
    args: { issue: "42" },
  };

  await runAgent({
    node: {
      type: "agent",
      label: "Test",
      prompt: "Do issue {{args.issue}}",
      system_prompt: "System for {{args.issue}}",
    },
    ctx,
    settings: makeSettings(),
    runtime: "claude",
    runtimeAdapter: adapter,
    cwd: dir,
  });

  const artifactPath = `${dir}/runs/test-node/system-prompt.md`;
  assertEquals(await Deno.readTextFile(artifactPath), "System for 42");
  // The artifact is for observers; the runtime gets the prompt inline, because
  // the ACP wire (the engine's only transport) carries no `systemPromptFile`.
  assertEquals(seen[0].systemPrompt, "System for 42");
  assertEquals(seen[0].systemPromptFile, undefined);
});

// Mirrors `ACP_UNSUPPORTED_INVOKE_OPTIONS` in @korchasa/ai-ide-cli
// `runtime/acp/mapping.ts` (FR-L39). The package does not export that list,
// so it is restated here; a drift shows up as a live-run failure, not here.
const ACP_REJECTED_INVOKE_OPTIONS = [
  "agent",
  "systemPromptFile",
  "extraArgs",
  "strictMcpConfig",
  "streamStallTimeoutSeconds",
  "streamLogPath",
  "verbosity",
  "onOutput",
];

for (const runtime of ["claude", "opencode", "codex"] as const) {
  Deno.test(`runAgent hands the ACP front no rejected option (${runtime})`, async () => {
    const dir = await Deno.makeTempDir();
    const seen: Record<string, unknown>[] = [];
    const adapter = fakeAdapter(seen, runtime);
    const ctx: TemplateContext = {
      ...makeCtx(),
      node_dir: "runs/test-node",
      workDir: dir,
      args: { issue: "42" },
    };

    await runAgent({
      node: {
        type: "agent",
        label: "Test",
        prompt: "Do issue {{args.issue}}",
        system_prompt: "System for {{args.issue}}",
      },
      ctx,
      settings: makeSettings(),
      runtime,
      runtimeAdapter: adapter,
      cwd: dir,
    });

    const leaked = ACP_REJECTED_INVOKE_OPTIONS.filter((k) =>
      seen[0][k] !== undefined && seen[0][k] !== null
    );
    assertEquals(leaked, []);
  });
}

Deno.test("runAgent hands the runtime an absolute cwd for a relative workDir", async () => {
  // The engine's workDir is repo-relative by design (template paths are
  // resolved against it), but the ACP front validates `cwd` as absolute.
  const rel = await Deno.makeTempDir({ dir: ".", prefix: "wd-" });
  try {
    const seen: Record<string, unknown>[] = [];
    const adapter = fakeAdapter(seen);
    const ctx: TemplateContext = {
      ...makeCtx(),
      node_dir: "runs/test-node",
      workDir: rel,
    };

    await runAgent({
      node: { type: "agent", label: "Test", prompt: "Do it" },
      ctx,
      settings: makeSettings(),
      runtime: "claude",
      runtimeAdapter: adapter,
      cwd: rel,
    });

    assertEquals(seen[0].cwd, resolve(rel));
  } finally {
    await Deno.remove(rel, { recursive: true });
  }
});

Deno.test('FR-E77 runAgent pins transport: "acp" on adapter.invoke', async () => {
  const dir = await Deno.makeTempDir();
  const seen: Record<string, unknown>[] = [];
  const adapter = fakeAdapter(seen);
  const ctx: TemplateContext = {
    ...makeCtx(),
    node_dir: "runs/test-node",
    workDir: dir,
    args: { issue: "42" },
  };

  await runAgent({
    node: { type: "agent", label: "Test", prompt: "Do issue {{args.issue}}" },
    ctx,
    settings: makeSettings(),
    runtime: "claude",
    runtimeAdapter: adapter,
    cwd: dir,
  });

  // The engine is ACP-only: every invoke must request the package's ACP
  // front explicitly (the package defaults to "cli" when transport is unset).
  assertEquals(seen[0].transport, "acp");
});

Deno.test("runAgent keeps inline system prompt for non-Claude runtimes", async () => {
  const dir = await Deno.makeTempDir();
  const seen: Record<string, unknown>[] = [];
  const adapter = fakeAdapter(seen, "opencode");
  const ctx: TemplateContext = {
    ...makeCtx(),
    node_dir: "runs/test-node",
    workDir: dir,
    args: { issue: "42" },
  };

  await runAgent({
    node: {
      type: "agent",
      label: "Test",
      prompt: "Do issue {{args.issue}}",
      system_prompt: "System for {{args.issue}}",
    },
    ctx,
    settings: makeSettings(),
    runtime: "opencode",
    runtimeAdapter: adapter,
    cwd: dir,
  });

  assertEquals(seen[0].systemPrompt, "System for 42");
  assertEquals(seen[0].systemPromptFile, undefined);
  await assertRejects(
    () => Deno.stat(`${dir}/runs/test-node/system-prompt.md`),
    Deno.errors.NotFound,
  );
});

Deno.test("runAgent fails clearly when system prompt artifact cannot be written", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/runs-file`, "not a dir");
  const seen: Record<string, unknown>[] = [];
  const adapter = fakeAdapter(seen);
  const ctx: TemplateContext = {
    ...makeCtx(),
    node_dir: "runs-file/test-node",
    workDir: dir,
  };

  await assertRejects(
    () =>
      runAgent({
        node: {
          type: "agent",
          label: "Test",
          prompt: "Do it",
          system_prompt: "System",
        },
        ctx,
        settings: makeSettings(),
        runtime: "claude",
        runtimeAdapter: adapter,
        cwd: dir,
        nodeId: "developer",
      }),
    Error,
    "Failed to write system prompt artifact for node 'developer'",
  );
  assertEquals(seen.length, 0);
});

Deno.test("settings — default values", () => {
  const settings = makeSettings();
  assertEquals(settings.max_continuations, 3);
  assertEquals(settings.timeout_seconds, 1800);
  assertEquals(settings.on_error, "fail");
  assertEquals(settings.max_retries, 3);
  assertEquals(settings.retry_delay_seconds, 5);
});

// --- Scope-check integration tests (FR-E37) ---

Deno.test("NodeConfig — allowed_paths field accepted by type system", () => {
  const node: NodeConfig = {
    type: "agent",
    label: "Scoped agent",
    prompt: "Do task",
    allowed_paths: ["engine/**", "engine/*_test.ts"],
  };
  assertEquals(Array.isArray(node.allowed_paths), true);
  assertEquals(node.allowed_paths![0], "engine/**");
  assertEquals(node.allowed_paths!.length, 2);
});

Deno.test("NodeConfig — allowed_paths absent by default", () => {
  const node: NodeConfig = {
    type: "agent",
    label: "No scope restriction",
    prompt: "Do task",
  };
  assertEquals(node.allowed_paths, undefined);
});

Deno.test("ValidationRule — scope_check type accepted by type system", () => {
  const rule: ValidationRule = { type: "scope_check", path: "" };
  assertEquals(rule.type, "scope_check");
  assertEquals(rule.path, "");
});

Deno.test("ValidationResult — scope_check failure structure", () => {
  const rule: ValidationRule = { type: "scope_check", path: "" };
  const result: ValidationResult = {
    rule,
    passed: false,
    message: "Out-of-scope modifications: .github/workflow.yaml",
  };
  assertEquals(result.rule.type, "scope_check");
  assertEquals(result.passed, false);
  assertEquals(result.message.includes(".github/workflow.yaml"), true);
});

// --- FR-E47: applyBudgetFlags ---

import { applyBudgetFlags } from "./agent.ts";

Deno.test("applyBudgetFlags — undefined maxTurns → returns base unchanged", () => {
  assertEquals(
    applyBudgetFlags({ "--foo": "" }, "claude", undefined),
    { "--foo": "" },
  );
  assertEquals(applyBudgetFlags(undefined, "claude", undefined), undefined);
});

Deno.test("applyBudgetFlags — claude + maxTurns → appends --max-turns N", () => {
  assertEquals(applyBudgetFlags(undefined, "claude", 50), {
    "--max-turns": "50",
  });
  assertEquals(applyBudgetFlags({ "--foo": "" }, "claude", 10), {
    "--foo": "",
    "--max-turns": "10",
  });
});

Deno.test("applyBudgetFlags — opencode + maxTurns → returns base unchanged", () => {
  assertEquals(
    applyBudgetFlags({ "--foo": "" }, "opencode", 50),
    { "--foo": "" },
  );
  assertEquals(applyBudgetFlags(undefined, "opencode", 50), undefined);
});

Deno.test("applyBudgetFlags — cursor + maxTurns → returns base unchanged", () => {
  assertEquals(applyBudgetFlags(undefined, "cursor", 25), undefined);
});

Deno.test("applyBudgetFlags — does not mutate the input base map", () => {
  const base = { "--foo": "" };
  const result = applyBudgetFlags(base, "claude", 5);
  assertEquals(base, { "--foo": "" });
  assertEquals(result, { "--foo": "", "--max-turns": "5" });
});

Deno.test("runAgent hitl capability — acp vector drops mcpInjection ⇒ no mcpServers emitted", async () => {
  const nodeDir = Deno.makeTempDirSync();
  const calls: Array<Record<string, unknown>> = [];

  const runtimeAdapter: RuntimeAdapter = {
    id: "opencode",
    capabilities: {
      permissionMode: false,
      mcpInjection: true,
      transcript: false,
      interactive: false,
      toolUseObservation: false,
      session: false,
      capabilityInventory: false,
      commandsFastChannel: false,
      toolFilter: true,
      reasoningEffort: false,
    },
    capabilitiesFor(transport) {
      if (transport === "acp") {
        return {
          permissionMode: false,
          mcpInjection: false,
          transcript: false,
          interactive: false,
          toolUseObservation: false,
          session: false,
          capabilityInventory: false,
          commandsFastChannel: false,
          toolFilter: false,
          reasoningEffort: false,
        };
      }
      return this.capabilities;
    },
    launchInteractive() {
      throw new Error("not implemented");
    },
    invoke: (opts) => {
      calls.push(opts as unknown as Record<string, unknown>);
      return Promise.resolve({
        output: {
          runtime: "opencode",
          result: "done",
          session_id: "s",
          total_cost_usd: 0,
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          is_error: false,
        },
      });
    },
  };

  await runAgent({
    node: { type: "agent", label: "Build", prompt: "build" } as NodeConfig,
    ctx: {
      node_dir: nodeDir,
      run_dir: nodeDir,
      run_id: "t",
      workDir: ".",
      args: {},
      env: {},
      input: {},
    } as TemplateContext,
    settings: makeSettings(),
    runtime: "opencode",
    runtimeAdapter,
    hitlConfig: {
      ask_script: "ask.sh",
      check_script: "check.sh",
      poll_interval: 60,
      timeout: 120,
    },
  });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].mcpServers, undefined);
  assertEquals(calls[0].onToolUseObserved, undefined);
});

Deno.test("runAgent hitl capability — acp vector keeps mcpInjection ⇒ mcpServers emitted", async () => {
  const nodeDir = Deno.makeTempDirSync();
  const calls: Array<Record<string, unknown>> = [];

  const runtimeAdapter: RuntimeAdapter = {
    id: "opencode",
    capabilities: {
      permissionMode: false,
      mcpInjection: true,
      transcript: false,
      interactive: false,
      toolUseObservation: false,
      session: false,
      capabilityInventory: false,
      commandsFastChannel: false,
      toolFilter: true,
      reasoningEffort: false,
    },
    capabilitiesFor(transport) {
      if (transport === "acp") {
        return { ...this.capabilities, mcpInjection: true };
      }
      return this.capabilities;
    },
    launchInteractive() {
      throw new Error("not implemented");
    },
    invoke: (opts) => {
      calls.push(opts as unknown as Record<string, unknown>);
      return Promise.resolve({
        output: {
          runtime: "opencode",
          result: "done",
          session_id: "s",
          total_cost_usd: 0,
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          is_error: false,
        },
      });
    },
  };

  await runAgent({
    node: { type: "agent", label: "Build", prompt: "build" } as NodeConfig,
    ctx: {
      node_dir: nodeDir,
      run_dir: nodeDir,
      run_id: "t",
      workDir: ".",
      args: {},
      env: {},
      input: {},
    } as TemplateContext,
    settings: makeSettings(),
    runtime: "opencode",
    runtimeAdapter,
    hitlConfig: {
      ask_script: "ask.sh",
      check_script: "check.sh",
      poll_interval: 60,
      timeout: 120,
    },
  });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].mcpServers !== undefined, true);
});

Deno.test("FR-E79 runtime onCallbackError surfaces as engine warn", async () => {
  const nodeDir = Deno.makeTempDirSync();
  const captured: string[] = [];
  const output = new OutputManager("normal", (text) => {
    captured.push(text);
  });

  const adapter: RuntimeAdapter = {
    id: "claude",
    capabilities: {
      permissionMode: true,
      transcript: true,
      interactive: false,
      toolUseObservation: true,
      session: false,
      capabilityInventory: false,
      commandsFastChannel: false,
      toolFilter: true,
      reasoningEffort: true,
      mcpInjection: false,
      sessionFidelity: "native",
    },
    launchInteractive() {
      throw new Error("not used");
    },
    invoke(opts) {
      opts.onCallbackError?.(
        new Error(
          `acp(claude): option "systemPrompt" degraded — inlined into prompt[0].text`,
        ),
        "onEvent",
      );
      return Promise.resolve({
        output: {
          result: "ok",
          session_id: "s",
          duration_ms: 1,
          num_turns: 1,
          is_error: false,
        },
      });
    },
  };

  await runAgent({
    node: { type: "agent", label: "Review", prompt: "review" } as NodeConfig,
    ctx: {
      node_dir: nodeDir,
      run_dir: nodeDir,
      run_id: "t",
      workDir: ".",
      args: {},
      env: {},
      input: {},
    } as TemplateContext,
    settings: makeSettings(),
    runtime: "claude",
    runtimeAdapter: adapter,
    output,
    nodeId: "tech-lead-review",
  });

  const joined = captured.join("");
  assertEquals(
    joined.includes("runtime onEvent:"),
    true,
    `expected runtime warn line in: ${joined}`,
  );
  assertEquals(
    joined.includes("tech-lead-review"),
    true,
    `expected node id in warn line: ${joined}`,
  );
  assertEquals(
    joined.includes(`option "systemPrompt" degraded`),
    true,
    `expected library message in warn line: ${joined}`,
  );
  assertEquals(
    joined.startsWith("WARN: ") || joined.includes("\nWARN: "),
    true,
    `expected WARN prefix in: ${joined}`,
  );
});

Deno.test("FR-E79 omitted OutputManager keeps onCallbackError undefined", async () => {
  const nodeDir = Deno.makeTempDirSync();
  const seen: Array<Record<string, unknown>> = [];
  const adapter: RuntimeAdapter = {
    id: "claude",
    capabilities: {
      permissionMode: true,
      transcript: true,
      interactive: false,
      toolUseObservation: true,
      session: false,
      capabilityInventory: false,
      commandsFastChannel: false,
      toolFilter: true,
      reasoningEffort: true,
      mcpInjection: false,
      sessionFidelity: "native",
    },
    launchInteractive() {
      throw new Error("not used");
    },
    invoke(opts) {
      seen.push(opts as unknown as Record<string, unknown>);
      return Promise.resolve({
        output: {
          result: "ok",
          session_id: "s",
          duration_ms: 1,
          num_turns: 1,
          is_error: false,
        },
      });
    },
  };

  await runAgent({
    node: { type: "agent", label: "Review", prompt: "review" } as NodeConfig,
    ctx: {
      node_dir: nodeDir,
      run_dir: nodeDir,
      run_id: "t",
      workDir: ".",
      args: {},
      env: {},
      input: {},
    } as TemplateContext,
    settings: makeSettings(),
    runtime: "claude",
    runtimeAdapter: adapter,
  });

  assertEquals(seen.length, 1);
  assertEquals(
    seen[0].onCallbackError,
    undefined,
    "library default must run when engine has no OutputManager",
  );
});

// --- FR-E82: fail-fast on runtime is_error (no continuation amplification) ---

// --- FR-E18 / FR-E20: engine-owned stream.log writer over ACP onEvent ---

function claudeAcpAdapter(
  invoke: RuntimeAdapter["invoke"],
): RuntimeAdapter {
  return {
    id: "claude",
    capabilities: {
      permissionMode: true,
      transcript: true,
      interactive: false,
      toolUseObservation: true,
      session: false,
      capabilityInventory: false,
      commandsFastChannel: false,
      toolFilter: true,
      reasoningEffort: true,
      mcpInjection: false,
      sessionFidelity: "native",
    },
    launchInteractive() {
      throw new Error("not used");
    },
    invoke,
  };
}

Deno.test("FR-E18 engine persists ACP onEvent stream to stream.log", async () => {
  const dir = await Deno.makeTempDir();
  const streamLogPath = `${dir}/stream.log`;
  const seen: Record<string, unknown>[] = [];
  const adapter = claudeAcpAdapter((opts) => {
    seen.push(opts as unknown as Record<string, unknown>);
    // The library's ACP invoke path forwards raw `session/update` params.
    opts.onEvent?.({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "hi from agent" },
    });
    return Promise.resolve({
      output: {
        result: "ok",
        session_id: "s",
        duration_ms: 1,
        num_turns: 1,
        is_error: false,
      },
    });
  });

  const result = await runAgent({
    node: { type: "agent", label: "T", prompt: "go" },
    ctx: { ...makeCtx(), workDir: dir },
    settings: makeSettings(),
    runtime: "claude",
    runtimeAdapter: adapter,
    streamLogPath,
    cwd: dir,
  });

  assertEquals(result.success, true);
  // Engine now owns the write — streamLogPath must NOT be forwarded to the
  // adapter (it is dropped under ACP and would trigger a spurious FR-E79 WARN).
  assertEquals(seen[0].streamLogPath, undefined);
  assertEquals(typeof seen[0].onEvent, "function");

  const content = await Deno.readTextFile(streamLogPath);
  assertEquals(content.includes("[stream] text: hi from agent"), true);
  assertEquals(
    /^\[\d{2}:\d{2}:\d{2}\] /.test(content.split("\n")[0]),
    true,
    `first line not timestamped: ${content.split("\n")[0]}`,
  );
  assertEquals(content.includes("--- end ---"), true);
});

Deno.test("FR-E18 stream.log appended across continuations", async () => {
  const dir = await Deno.makeTempDir();
  const streamLogPath = `${dir}/stream.log`;
  let invokeCount = 0;
  const adapter = claudeAcpAdapter((opts) => {
    invokeCount++;
    opts.onEvent?.({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `turn ${invokeCount}` },
    });
    return Promise.resolve({
      output: {
        result: "ok",
        session_id: "s",
        duration_ms: 1,
        num_turns: 1,
        is_error: false,
      },
    });
  });

  const result = await runAgent({
    node: {
      type: "agent",
      label: "T",
      prompt: "go",
      // Validation never passes → forces the continuation loop.
      validate: [{ type: "file_exists", path: "{{node_dir}}/never.md" }],
    },
    ctx: { ...makeCtx(), node_dir: "node", workDir: dir },
    settings: { ...makeSettings(), max_continuations: 1 },
    runtime: "claude",
    runtimeAdapter: adapter,
    streamLogPath,
    cwd: dir,
  });

  // Initial invoke + one continuation, both emitting to the SAME handle.
  assertEquals(result.success, false);
  assertEquals(invokeCount, 2);
  const content = await Deno.readTextFile(streamLogPath);
  assertEquals(content.includes("[stream] text: turn 1"), true);
  assertEquals(
    content.includes("[stream] text: turn 2"),
    true,
    "continuation must append, not truncate prior turns",
  );
});

Deno.test("FR-E18 stream-log open failure fails node with cli_crash", async () => {
  const dir = await Deno.makeTempDir();
  // Parent path is a regular file → opening a child fails (ENOTDIR).
  await Deno.writeTextFile(`${dir}/blocker`, "file");
  const seen: Record<string, unknown>[] = [];
  const adapter = claudeAcpAdapter((opts) => {
    seen.push(opts as unknown as Record<string, unknown>);
    return Promise.resolve({
      output: {
        result: "ok",
        session_id: "s",
        duration_ms: 1,
        num_turns: 1,
        is_error: false,
      },
    });
  });

  const result = await runAgent({
    node: { type: "agent", label: "T", prompt: "go" },
    ctx: { ...makeCtx(), workDir: dir },
    settings: makeSettings(),
    runtime: "claude",
    runtimeAdapter: adapter,
    streamLogPath: `${dir}/blocker/stream.log`,
    cwd: dir,
  });

  assertEquals(result.success, false);
  assertEquals(result.error_category, "cli_crash");
  assertEquals(result.continuations, 0);
  assertEquals(seen.length, 0, "must fail before reaching adapter.invoke");
});

Deno.test("FR-E82 runAgent fails fast on result.output.is_error and skips continuation", async () => {
  const dir = await Deno.makeTempDir();
  let invocations = 0;
  const adapter: RuntimeAdapter = {
    id: "codex",
    capabilities: {
      permissionMode: false,
      transcript: true,
      interactive: false,
      toolUseObservation: true,
      session: false,
      capabilityInventory: false,
      commandsFastChannel: false,
      toolFilter: false,
      reasoningEffort: true,
      mcpInjection: false,
      sessionFidelity: "native",
    },
    invoke() {
      invocations++;
      return Promise.resolve({
        output: {
          runtime: "codex",
          result:
            '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"model not supported"}}',
          session_id: "thread-1",
          duration_ms: 1,
          num_turns: 0,
          is_error: true,
        },
        error: "Codex CLI returned error: model not supported",
      });
    },
    launchInteractive() {
      throw new Error("not used");
    },
  };
  const ctx: TemplateContext = {
    node_dir: `${dir}/node`,
    run_dir: dir,
    run_id: "t",
    workDir: ".",
    args: {},
    env: {},
    input: {},
  };
  await Deno.mkdir(ctx.node_dir, { recursive: true });

  const result = await runAgent({
    node: {
      type: "agent",
      label: "BugHunter",
      prompt: "scan",
      validate: [
        { type: "file_exists", path: "{{node_dir}}/site-check-report.md" },
      ],
    } as NodeConfig,
    ctx,
    settings: { ...makeSettings(), max_continuations: 8 },
    runtime: "codex",
    runtimeAdapter: adapter,
    cwd: dir,
  });

  assertEquals(result.success, false);
  assertEquals(result.continuations, 0);
  assertEquals(result.error_category, "cli_crash");
  assertEquals(invocations, 1, "must NOT enter continuation/--resume loop");
});
