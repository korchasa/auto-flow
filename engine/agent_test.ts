import { assertEquals } from "@std/assert";
import { buildClaudeArgs, formatEventForOutput } from "./agent.ts";
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
    prompt: "agents/executor/SKILL.md",
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

Deno.test("buildClaudeArgs — model present without resume emits --model", () => {
  const args = buildClaudeArgs(
    makeInvokeOpts({ model: "claude-sonnet-4-6" }),
  );
  const idx = args.indexOf("--model");
  assertEquals(idx >= 0, true, "should contain --model");
  assertEquals(args[idx + 1], "claude-sonnet-4-6");
});

Deno.test("buildClaudeArgs — model present with resume omits --model", () => {
  const args = buildClaudeArgs(
    makeInvokeOpts({
      model: "claude-sonnet-4-6",
      resumeSessionId: "sess-abc",
    }),
  );
  assertEquals(
    args.includes("--model"),
    false,
    "resume should not emit --model",
  );
});

Deno.test("buildClaudeArgs — model absent omits --model", () => {
  const args = buildClaudeArgs(makeInvokeOpts());
  assertEquals(args.includes("--model"), false, "no model = no --model flag");
});

Deno.test("formatEventForOutput — system init", () => {
  const out = formatEventForOutput({
    type: "system",
    subtype: "init",
    model: "claude-opus-4-6",
  });
  assertEquals(out, "[stream] init model=claude-opus-4-6");
});

Deno.test("formatEventForOutput — assistant text", () => {
  const out = formatEventForOutput({
    type: "assistant",
    message: { content: [{ type: "text", text: "Hello world" }] },
  });
  assertEquals(out, "[stream] text: Hello world");
});

Deno.test("formatEventForOutput — assistant tool_use without input", () => {
  const out = formatEventForOutput({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Bash" }] },
  });
  assertEquals(out, "[stream] tool: Bash");
});

Deno.test("formatEventForOutput — Read shows file_path", () => {
  const out = formatEventForOutput({
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        name: "Read",
        input: { file_path: "/workspaces/project/src/main.ts" },
      }],
    },
  });
  assertEquals(out, "[stream] tool: Read src/main.ts");
});

Deno.test("formatEventForOutput — Bash shows description", () => {
  const out = formatEventForOutput({
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        name: "Bash",
        input: {
          command: "git status --porcelain",
          description: "Check git status",
        },
      }],
    },
  });
  assertEquals(out, "[stream] tool: Bash Check git status");
});

Deno.test("formatEventForOutput — Bash falls back to command when no description", () => {
  const out = formatEventForOutput({
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        name: "Bash",
        input: { command: "deno task check" },
      }],
    },
  });
  assertEquals(out, "[stream] tool: Bash `deno task check`");
});

Deno.test("formatEventForOutput — Grep shows pattern and path", () => {
  const out = formatEventForOutput({
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        name: "Grep",
        input: { pattern: "TODO", path: "/workspaces/project/src/" },
      }],
    },
  });
  assertEquals(out, "[stream] tool: Grep /TODO/ in src/");
});

Deno.test("formatEventForOutput — Write shows file_path", () => {
  const out = formatEventForOutput({
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        name: "Write",
        input: {
          file_path: "/workspaces/project/src/utils.ts",
          content: "...",
        },
      }],
    },
  });
  assertEquals(out, "[stream] tool: Write src/utils.ts");
});

Deno.test("formatEventForOutput — Edit shows file_path", () => {
  const out = formatEventForOutput({
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        name: "Edit",
        input: {
          file_path: "/workspaces/project/src/main.ts",
          old_string: "a",
          new_string: "b",
        },
      }],
    },
  });
  assertEquals(out, "[stream] tool: Edit src/main.ts");
});

Deno.test("formatEventForOutput — Glob shows pattern", () => {
  const out = formatEventForOutput({
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        name: "Glob",
        input: { pattern: "**/*.ts" },
      }],
    },
  });
  assertEquals(out, "[stream] tool: Glob **/*.ts");
});

Deno.test("formatEventForOutput — Agent shows description", () => {
  const out = formatEventForOutput({
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        name: "Agent",
        input: {
          description: "Explore codebase",
          prompt: "...",
          subagent_type: "Explore",
        },
      }],
    },
  });
  assertEquals(out, "[stream] tool: Agent Explore codebase");
});

Deno.test("formatEventForOutput — long Bash command truncated", () => {
  const longCmd = "x".repeat(200);
  const out = formatEventForOutput({
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        name: "Bash",
        input: { command: longCmd },
      }],
    },
  });
  assertEquals(out, "[stream] tool: Bash `" + "x".repeat(80) + "…`");
});

Deno.test("formatEventForOutput — result success", () => {
  const out = formatEventForOutput({
    type: "result",
    subtype: "success",
    duration_ms: 5000,
    total_cost_usd: 0.1234,
  });
  assertEquals(out, "[stream] result: success (5000ms, $0.1234)");
});

Deno.test("formatEventForOutput — unknown type returns empty", () => {
  assertEquals(formatEventForOutput({ type: "rate_limit" }), "");
});

Deno.test("formatEventForOutput — long text truncated at 120 chars", () => {
  const longText = "x".repeat(200);
  const out = formatEventForOutput({
    type: "assistant",
    message: { content: [{ type: "text", text: longText }] },
  });
  assertEquals(out.includes("x".repeat(120) + "…"), true);
  assertEquals(out.includes("x".repeat(121)), false);
});
