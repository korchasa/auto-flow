import { assertEquals } from "@std/assert";
import { buildClaudeArgs } from "./agent.ts";
import type { AgentRunOptions, InvokeOptions } from "./agent.ts";
import { OutputManager } from "./output.ts";
import type { NodeConfig, NodeSettings, TemplateContext } from "./types.ts";

// Note: Full integration tests for runAgent require a real claude CLI.
// These tests verify the module's helpers and data structures.
// Integration tests will be added when running with claude CLI available.

function makeSettings(): Required<NodeSettings> {
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
    args: { issue: "42" },
    env: {},
    input: {},
  };
}

Deno.test("AgentRunOptions — type structure with OutputManager", () => {
  const node: NodeConfig = {
    type: "agent",
    label: "Test agent",
    prompt: ".sdlc/agents/test.md",
    task_template: "Do task for issue #{{args.issue}}",
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
    nodeId: "executor",
  };

  assertEquals(opts.node.type, "agent");
  assertEquals(opts.settings.max_continuations, 3);
  assertEquals(opts.output instanceof OutputManager, true);
  assertEquals(opts.nodeId, "executor");
});

Deno.test("AgentRunOptions — output and nodeId are optional", () => {
  const node: NodeConfig = {
    type: "agent",
    label: "Test",
    task_template: "Do something",
  };

  const opts: AgentRunOptions = {
    node,
    ctx: makeCtx(),
    settings: makeSettings(),
  };

  assertEquals(opts.output, undefined);
  assertEquals(opts.nodeId, undefined);
});

Deno.test("AgentRunOptions — task_template interpolation structure", () => {
  const node: NodeConfig = {
    type: "agent",
    label: "Test",
    task_template:
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

  assertEquals(opts.node.task_template!.includes("{{input.spec}}"), true);
  assertEquals(opts.ctx.input.spec, "/runs/test/spec");
});

Deno.test("AgentRunOptions — loop context available", () => {
  const ctx: TemplateContext = {
    ...makeCtx(),
    loop: { iteration: 2 },
  };

  assertEquals(ctx.loop!.iteration, 2);
});

function makeInvokeOpts(
  overrides?: Partial<InvokeOptions>,
): InvokeOptions {
  return {
    taskPrompt: "do something",
    timeoutSeconds: 60,
    maxRetries: 1,
    retryDelaySeconds: 1,
    ...overrides,
  };
}

Deno.test("buildClaudeArgs — includes extra claudeArgs", () => {
  const args = buildClaudeArgs(
    makeInvokeOpts({
      claudeArgs: ["--dangerously-skip-permissions"],
    }),
  );
  assertEquals(args.includes("--dangerously-skip-permissions"), true);
  assertEquals(args.includes("--output-format"), true);
  assertEquals(args.includes("-p"), true);
});

Deno.test("buildClaudeArgs — claudeArgs placed before -p", () => {
  const args = buildClaudeArgs(
    makeInvokeOpts({
      claudeArgs: ["--dangerously-skip-permissions", "--verbose"],
    }),
  );
  const pIdx = args.indexOf("-p");
  const dspIdx = args.indexOf("--dangerously-skip-permissions");
  assertEquals(dspIdx < pIdx, true, "claudeArgs should appear before -p");
});

Deno.test("buildClaudeArgs — no claudeArgs by default", () => {
  const args = buildClaudeArgs(makeInvokeOpts());
  assertEquals(args.includes("--dangerously-skip-permissions"), false);
});

Deno.test("buildClaudeArgs — resume mode omits promptFile", () => {
  const args = buildClaudeArgs(
    makeInvokeOpts({
      resumeSessionId: "sess-123",
      promptFile: "prompt.md",
    }),
  );
  assertEquals(args.includes("--resume"), true);
  assertEquals(args.includes("--append-system-prompt-file"), false);
});

Deno.test("settings — default values", () => {
  const settings = makeSettings();
  assertEquals(settings.max_continuations, 3);
  assertEquals(settings.timeout_seconds, 1800);
  assertEquals(settings.on_error, "fail");
  assertEquals(settings.max_retries, 3);
  assertEquals(settings.retry_delay_seconds, 5);
});
