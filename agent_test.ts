import { assertEquals } from "@std/assert";
import type { AgentRunOptions } from "./agent.ts";
import { buildClaudeArgs } from "@korchasa/ai-ide-cli/claude/process";
import type { ClaudeInvokeOptions } from "@korchasa/ai-ide-cli/claude/process";
import { OutputManager } from "./output.ts";
import {
  extractClaudeOutput,
  FileReadTracker,
  formatEventForOutput,
  formatFooter,
  processStreamEvent,
  stampLines,
  tsPrefix,
} from "@korchasa/ai-ide-cli/claude/stream";
import type {
  ClaudeResultEvent,
  ClaudeStreamEvent,
  StreamProcessorState,
} from "@korchasa/ai-ide-cli/claude/stream";
import type {
  NodeConfig,
  NodeSettings,
  TemplateContext,
  ValidationRule,
} from "./types.ts";
import type { ValidationResult } from "./validate.ts";

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

function makeInvokeOpts(
  overrides?: Partial<ClaudeInvokeOptions>,
): ClaudeInvokeOptions {
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
      claudeArgs: { "--dangerously-skip-permissions": "" },
    }),
  );
  assertEquals(args.includes("--dangerously-skip-permissions"), true);
  assertEquals(args.includes("--output-format"), true);
  assertEquals(args.includes("-p"), true);
});

Deno.test("buildClaudeArgs — claudeArgs placed before -p", () => {
  const args = buildClaudeArgs(
    makeInvokeOpts({
      claudeArgs: {
        "--dangerously-skip-permissions": "",
        "--add-dir": "/tmp",
      },
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

Deno.test("buildClaudeArgs — agent emits --agent flag", () => {
  const args = buildClaudeArgs(
    makeInvokeOpts({ agent: "agent-pm" }),
  );
  const idx = args.indexOf("--agent");
  assertEquals(idx >= 0, true, "should contain --agent");
  assertEquals(args[idx + 1], "agent-pm");
});

Deno.test("buildClaudeArgs — systemPrompt emits --append-system-prompt", () => {
  const args = buildClaudeArgs(
    makeInvokeOpts({ systemPrompt: "Extra context here." }),
  );
  const idx = args.indexOf("--append-system-prompt");
  assertEquals(idx >= 0, true, "should contain --append-system-prompt");
  assertEquals(args[idx + 1], "Extra context here.");
});

Deno.test("buildClaudeArgs — agent + systemPrompt both present", () => {
  const args = buildClaudeArgs(
    makeInvokeOpts({ agent: "agent-pm", systemPrompt: "Extra." }),
  );
  assertEquals(args.includes("--agent"), true);
  assertEquals(args.includes("--append-system-prompt"), true);
});

Deno.test("buildClaudeArgs — agent + systemPrompt omitted on resume", () => {
  const args = buildClaudeArgs(
    makeInvokeOpts({
      resumeSessionId: "sess-456",
      agent: "agent-pm",
      systemPrompt: "Extra.",
    }),
  );
  assertEquals(args.includes("--agent"), false);
  assertEquals(args.includes("--append-system-prompt"), false);
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
        input: { pattern: "TO" + "DO", path: "/workspaces/project/src/" },
      }],
    },
  });
  assertEquals(out, `[stream] tool: Grep /${"TO" + "DO"}/ in src/`);
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

Deno.test("tsPrefix — returns [HH:MM:SS] format", () => {
  const prefix = tsPrefix();
  assertEquals(
    /^\[\d{2}:\d{2}:\d{2}\]$/.test(prefix),
    true,
    `expected [HH:MM:SS] format, got: ${prefix}`,
  );
});

Deno.test("stampLines — single line gets timestamp prefix", () => {
  const result = stampLines("[stream] text: hello");
  assertEquals(
    /^\[\d{2}:\d{2}:\d{2}\] \[stream\] text: hello$/.test(result),
    true,
    `unexpected result: ${result}`,
  );
});

Deno.test("stampLines — multi-line: each non-empty line gets timestamp", () => {
  const input = "[stream] text: line1\n[stream] text: line2";
  const result = stampLines(input);
  const lines = result.split("\n");
  assertEquals(lines.length, 2);
  assertEquals(
    /^\[\d{2}:\d{2}:\d{2}\] \[stream\] text: line1$/.test(lines[0]),
    true,
    `line 0: ${lines[0]}`,
  );
  assertEquals(
    /^\[\d{2}:\d{2}:\d{2}\] \[stream\] text: line2$/.test(lines[1]),
    true,
    `line 1: ${lines[1]}`,
  );
});

Deno.test("stampLines — empty lines pass through without timestamp", () => {
  const input = "[stream] line1\n\n[stream] line2";
  const result = stampLines(input);
  const lines = result.split("\n");
  assertEquals(lines.length, 3);
  assertEquals(
    /^\[\d{2}:\d{2}:\d{2}\] /.test(lines[0]),
    true,
    `line 0: ${lines[0]}`,
  );
  assertEquals(lines[1], "");
  assertEquals(
    /^\[\d{2}:\d{2}:\d{2}\] /.test(lines[2]),
    true,
    `line 2: ${lines[2]}`,
  );
});

Deno.test("formatFooter — normal case produces correct format", () => {
  const output = extractClaudeOutput({
    type: "result",
    result: "done",
    session_id: "sess-1",
    is_error: false,
    subtype: "success",
    total_cost_usd: 0.0123,
    duration_ms: 5000,
    duration_api_ms: 4000,
    num_turns: 3,
  });
  const footer = formatFooter(output);
  assertEquals(footer, "status=ok duration=5.0s cost=$0.0123 turns=3");
});

Deno.test("formatFooter — error case uses status=error", () => {
  const output = extractClaudeOutput({
    type: "result",
    result: "failed",
    session_id: "sess-2",
    is_error: true,
    subtype: "error",
    total_cost_usd: 0.005,
    duration_ms: 2500,
    duration_api_ms: 2000,
    num_turns: 1,
  });
  const footer = formatFooter(output);
  assertEquals(footer, "status=error duration=2.5s cost=$0.0050 turns=1");
});

Deno.test("formatFooter — zero values produce valid footer", () => {
  const output = extractClaudeOutput({
    type: "result",
    result: "",
    session_id: "",
    is_error: false,
    subtype: "success",
    total_cost_usd: 0,
    duration_ms: 0,
    duration_api_ms: 0,
    num_turns: 0,
  });
  const footer = formatFooter(output);
  assertEquals(footer, "status=ok duration=0.0s cost=$0.0000 turns=0");
});

Deno.test("formatEventForOutput — semi-verbose suppresses tool_use blocks", () => {
  const out = formatEventForOutput(
    {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Hello" },
          { type: "tool_use", name: "Bash", input: { command: "ls" } },
        ],
      },
    },
    "semi-verbose",
  );
  assertEquals(out, "[stream] text: Hello");
  assertEquals(out.includes("tool"), false);
});

Deno.test("formatEventForOutput — semi-verbose emits text blocks only", () => {
  const out = formatEventForOutput(
    {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Read", input: { file_path: "/a.ts" } },
          { type: "text", text: "Done" },
          { type: "tool_use", name: "Write", input: { file_path: "/b.ts" } },
        ],
      },
    },
    "semi-verbose",
  );
  assertEquals(out, "[stream] text: Done");
});

Deno.test("formatEventForOutput — semi-verbose with only tool_use returns empty", () => {
  const out = formatEventForOutput(
    {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Bash", input: { command: "pwd" } },
        ],
      },
    },
    "semi-verbose",
  );
  assertEquals(out, "");
});

Deno.test("formatEventForOutput — undefined verbosity emits all blocks (backward-compat)", () => {
  const out = formatEventForOutput({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "Hi" },
        { type: "tool_use", name: "Bash", input: { command: "ls" } },
      ],
    },
  });
  assertEquals(out.includes("[stream] text: Hi"), true);
  assertEquals(out.includes("[stream] tool: Bash"), true);
});

Deno.test("formatEventForOutput — verbose verbosity emits all blocks", () => {
  const out = formatEventForOutput(
    {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Hi" },
          { type: "tool_use", name: "Bash", input: { command: "ls" } },
        ],
      },
    },
    "verbose",
  );
  assertEquals(out.includes("[stream] text: Hi"), true);
  assertEquals(out.includes("[stream] tool: Bash"), true);
});

Deno.test("formatEventForOutput — normal verbosity emits all blocks", () => {
  const out = formatEventForOutput(
    {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Hi" },
          { type: "tool_use", name: "Bash", input: { command: "ls" } },
        ],
      },
    },
    "normal",
  );
  assertEquals(out.includes("[stream] text: Hi"), true);
  assertEquals(out.includes("[stream] tool: Bash"), true);
});

Deno.test("turn separators + footer — stream log integration", async () => {
  const tmpPath = await Deno.makeTempFile({ suffix: ".jsonl" });
  try {
    const logFile = await Deno.open(tmpPath, {
      write: true,
      create: true,
      append: true,
    });
    const encoder = new TextEncoder();

    // Simulate the same logic as executeClaudeProcess
    let turnCount = 0;
    let resultEvent: ReturnType<typeof extractClaudeOutput> | undefined;

    const events: ClaudeStreamEvent[] = [
      {
        type: "system",
        subtype: "init",
        model: "test-model",
      } as ClaudeStreamEvent,
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "turn 1 response" }] },
      } as ClaudeStreamEvent,
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "turn 2 response" }] },
      } as ClaudeStreamEvent,
      {
        type: "result",
        subtype: "success",
        result: "done",
        session_id: "sess-test",
        is_error: false,
        total_cost_usd: 0.01,
        duration_ms: 3000,
        duration_api_ms: 2500,
        num_turns: 2,
      } as ClaudeResultEvent,
    ];

    for (const event of events) {
      if (event.type === "assistant") {
        turnCount++;
        await logFile.write(
          encoder.encode(stampLines(`--- turn ${turnCount} ---`) + "\n"),
        );
      }
      if (event.type === "result") {
        resultEvent = extractClaudeOutput(event as ClaudeResultEvent);
      }
      const summary = formatEventForOutput(event);
      if (summary) {
        await logFile.write(encoder.encode(stampLines(summary) + "\n"));
      }
      if (event.type === "result" && resultEvent) {
        await logFile.write(encoder.encode(stampLines("--- end ---") + "\n"));
        await logFile.write(
          encoder.encode(stampLines(formatFooter(resultEvent)) + "\n"),
        );
      }
    }
    logFile.close();

    const content = await Deno.readTextFile(tmpPath);
    const lines = content.split("\n").filter((l) => l.trim());

    // Verify timestamps on all lines
    for (const line of lines) {
      assertEquals(
        /^\[\d{2}:\d{2}:\d{2}\] /.test(line),
        true,
        `line missing timestamp: ${line}`,
      );
    }

    // Verify turn separators appear in order
    const separatorLines = lines.filter((l) => l.includes("--- turn "));
    assertEquals(separatorLines.length, 2, "expected 2 turn separators");
    assertEquals(separatorLines[0].includes("--- turn 1 ---"), true);
    assertEquals(separatorLines[1].includes("--- turn 2 ---"), true);

    // Verify footer
    const endLine = lines.find((l) => l.includes("--- end ---"));
    assertEquals(endLine !== undefined, true, "expected --- end --- line");
    const footerLine = lines.find((l) => l.includes("status=ok"));
    assertEquals(footerLine !== undefined, true, "expected footer line");
    assertEquals(footerLine!.includes("duration=3.0s"), true);
    assertEquals(footerLine!.includes("cost=$0.0100"), true);
    assertEquals(footerLine!.includes("turns=2"), true);

    // Verify order: turn separators before footer
    const sep1Idx = lines.findIndex((l) => l.includes("--- turn 1 ---"));
    const sep2Idx = lines.findIndex((l) => l.includes("--- turn 2 ---"));
    const endIdx = lines.findIndex((l) => l.includes("--- end ---"));
    assertEquals(sep1Idx < sep2Idx, true, "turn 1 should precede turn 2");
    assertEquals(sep2Idx < endIdx, true, "turn 2 should precede end");
  } finally {
    await Deno.remove(tmpPath);
  }
});

Deno.test("turn separators + footer — append semantics: two invocations", async () => {
  const tmpPath = await Deno.makeTempFile({ suffix: ".jsonl" });
  try {
    const encoder = new TextEncoder();
    const resultEventData: ClaudeResultEvent = {
      type: "result",
      subtype: "success",
      result: "done",
      session_id: "sess-x",
      is_error: false,
      total_cost_usd: 0.005,
      duration_ms: 1000,
      duration_api_ms: 800,
      num_turns: 1,
    };

    // First invocation
    for (let inv = 0; inv < 2; inv++) {
      const logFile = await Deno.open(tmpPath, {
        write: true,
        create: true,
        append: true,
      });
      let turnCount = 0;
      const assistantEvent = {
        type: "assistant",
        message: { content: [{ type: "text", text: `inv ${inv} response` }] },
      };
      // Turn separator
      turnCount++;
      await logFile.write(
        encoder.encode(stampLines(`--- turn ${turnCount} ---`) + "\n"),
      );
      // Content
      const summary = formatEventForOutput(assistantEvent);
      if (summary) {
        await logFile.write(encoder.encode(stampLines(summary) + "\n"));
      }
      // Footer
      const resultOut = extractClaudeOutput(resultEventData);
      await logFile.write(encoder.encode(stampLines("--- end ---") + "\n"));
      await logFile.write(
        encoder.encode(stampLines(formatFooter(resultOut)) + "\n"),
      );
      logFile.close();
    }

    const content = await Deno.readTextFile(tmpPath);
    const separatorLines = content.split("\n").filter((l) =>
      l.includes("--- turn ")
    );
    assertEquals(
      separatorLines.length,
      2,
      "two invocations should produce 2 turn separators in appended log",
    );
    const endLines = content.split("\n").filter((l) =>
      l.includes("--- end ---")
    );
    assertEquals(
      endLines.length,
      2,
      "two invocations should produce 2 end markers",
    );
  } finally {
    await Deno.remove(tmpPath);
  }
});

// --- FileReadTracker unit tests ---

Deno.test("FileReadTracker — threshold boundary: 2 reads = null, 3rd = warning", () => {
  const tracker = new FileReadTracker();
  assertEquals(tracker.track("/a.ts"), null, "1st read: no warning");
  assertEquals(tracker.track("/a.ts"), null, "2nd read: no warning");
  const warn = tracker.track("/a.ts");
  assertEquals(warn !== null, true, "3rd read: should warn");
  assertEquals(warn, "[WARN] repeated file read: /a.ts (3 times)");
});

Deno.test("FileReadTracker — per-path independence", () => {
  const tracker = new FileReadTracker();
  // path A: 3 reads → warns
  tracker.track("/a.ts");
  tracker.track("/a.ts");
  const warnA = tracker.track("/a.ts");
  assertEquals(warnA, "[WARN] repeated file read: /a.ts (3 times)");
  // path B: 2 reads → no warning
  tracker.track("/b.ts");
  const warnB = tracker.track("/b.ts");
  assertEquals(warnB, null, "path B at 2 reads should not warn");
});

Deno.test("FileReadTracker — warning format matches [WARN] repeated file read: <path> (<N> times)", () => {
  const tracker = new FileReadTracker();
  tracker.track("/engine/agent.ts");
  tracker.track("/engine/agent.ts");
  const warn = tracker.track("/engine/agent.ts");
  assertEquals(
    /^\[WARN\] repeated file read: .+ \(\d+ times\)$/.test(warn ?? ""),
    true,
    `unexpected format: ${warn}`,
  );
});

Deno.test("FileReadTracker — consecutive warnings: 4th read returns (4 times)", () => {
  const tracker = new FileReadTracker();
  tracker.track("/x.ts");
  tracker.track("/x.ts");
  tracker.track("/x.ts"); // 3rd — first warning
  const warn4 = tracker.track("/x.ts"); // 4th
  assertEquals(warn4, "[WARN] repeated file read: /x.ts (4 times)");
});

Deno.test("FileReadTracker — reset clears counts", () => {
  const tracker = new FileReadTracker();
  tracker.track("/a.ts");
  tracker.track("/a.ts");
  tracker.track("/a.ts"); // 3rd — would warn
  tracker.reset();
  // After reset, counts restart
  assertEquals(tracker.track("/a.ts"), null, "after reset: 1st read no warn");
  assertEquals(tracker.track("/a.ts"), null, "after reset: 2nd read no warn");
});

Deno.test("FileReadTracker — custom threshold", () => {
  const tracker = new FileReadTracker(1); // threshold=1: warn after 1st read (count>1 = 2nd)
  assertEquals(tracker.track("/a.ts"), null, "1st read: no warning");
  const warn = tracker.track("/a.ts");
  assertEquals(warn, "[WARN] repeated file read: /a.ts (2 times)");
});

// --- Integration test: repeated reads produce warning lines in log file ---

Deno.test("FileReadTracker — integration: repeated reads written to log file", async () => {
  const tmpPath = await Deno.makeTempFile({ suffix: ".jsonl" });
  try {
    const logFile = await Deno.open(tmpPath, {
      write: true,
      create: true,
      append: true,
    });
    const encoder = new TextEncoder();
    const tracker = new FileReadTracker();

    // Simulate the event loop logic from executeClaudeProcess
    const events = [
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Read", input: { file_path: "/a.ts" } },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Read", input: { file_path: "/a.ts" } },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Read", input: { file_path: "/a.ts" } }, // 3rd — triggers warning
            { type: "tool_use", name: "Read", input: { file_path: "/b.ts" } }, // different path — no warning
          ],
        },
      },
    ];

    for (const event of events) {
      if (event.type === "assistant") {
        const contents = event.message?.content;
        if (Array.isArray(contents)) {
          for (const block of contents) {
            if (block.type === "tool_use" && block.name === "Read") {
              const warn = tracker.track(block.input?.file_path);
              if (warn) {
                await logFile.write(
                  encoder.encode(stampLines(warn) + "\n"),
                );
              }
            }
          }
        }
      }
    }
    logFile.close();

    const content = await Deno.readTextFile(tmpPath);
    const lines = content.split("\n").filter((l) => l.trim());

    // Should have exactly 1 warning line (for /a.ts on 3rd read)
    assertEquals(lines.length, 1, "expected exactly 1 warning line");
    assertEquals(
      lines[0].includes("[WARN] repeated file read: /a.ts (3 times)"),
      true,
      `unexpected line: ${lines[0]}`,
    );
    // Warning line should have timestamp
    assertEquals(
      /^\[\d{2}:\d{2}:\d{2}\] /.test(lines[0]),
      true,
      `warning missing timestamp: ${lines[0]}`,
    );
  } finally {
    await Deno.remove(tmpPath);
  }
});

// --- processStreamEvent unit tests ---

function makeStreamState(
  overrides?: Partial<StreamProcessorState>,
): StreamProcessorState {
  return {
    turnCount: 0,
    resultEvent: undefined,
    tracker: new FileReadTracker(),
    logFile: undefined,
    encoder: new TextEncoder(),
    onOutput: undefined,
    verbosity: undefined,
    ...overrides,
  };
}

Deno.test("processStreamEvent — turn counting increments on assistant events", async () => {
  const state = makeStreamState();
  await processStreamEvent(
    { type: "assistant", message: { content: [{ type: "text", text: "hi" }] } },
    state,
  );
  assertEquals(state.turnCount, 1);
  await processStreamEvent(
    { type: "assistant", message: { content: [{ type: "text", text: "hi" }] } },
    state,
  );
  assertEquals(state.turnCount, 2);
  // non-assistant event does not increment
  await processStreamEvent(
    { type: "system", subtype: "init", model: "x" },
    state,
  );
  assertEquals(state.turnCount, 2);
});

Deno.test("processStreamEvent — FileReadTracker warning written to log on repeated Read tool_use", async () => {
  const tmpPath = await Deno.makeTempFile({ suffix: ".jsonl" });
  try {
    const logFile = await Deno.open(tmpPath, {
      write: true,
      create: true,
      append: true,
    });
    const state = makeStreamState({ logFile });
    const readEvent = (path: string) => ({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          name: "Read",
          input: { file_path: path },
        }],
      },
    });
    // 3 reads of same path → warning on 3rd
    await processStreamEvent(readEvent("/x.ts"), state);
    await processStreamEvent(readEvent("/x.ts"), state);
    await processStreamEvent(readEvent("/x.ts"), state); // 3rd: triggers warning
    logFile.close();
    const content = await Deno.readTextFile(tmpPath);
    const warnLines = content.split("\n").filter((l) =>
      l.includes("[WARN] repeated file read: /x.ts")
    );
    assertEquals(warnLines.length, 1, "expected exactly 1 warning line");
  } finally {
    await Deno.remove(tmpPath);
  }
});

Deno.test("processStreamEvent — result event populates state.resultEvent", async () => {
  const state = makeStreamState();
  assertEquals(state.resultEvent, undefined);
  await processStreamEvent(
    {
      type: "result",
      subtype: "success",
      result: "done",
      session_id: "s1",
      is_error: false,
      total_cost_usd: 0.01,
      duration_ms: 1000,
      duration_api_ms: 800,
      num_turns: 2,
    },
    state,
  );
  assertEquals(state.resultEvent !== undefined, true);
  assertEquals(state.resultEvent!.result, "done");
  assertEquals(state.resultEvent!.num_turns, 2);
});

Deno.test("processStreamEvent — footer written to log after result event", async () => {
  const tmpPath = await Deno.makeTempFile({ suffix: ".jsonl" });
  try {
    const logFile = await Deno.open(tmpPath, {
      write: true,
      create: true,
      append: true,
    });
    const state = makeStreamState({ logFile });
    await processStreamEvent(
      {
        type: "result",
        subtype: "success",
        result: "done",
        session_id: "s1",
        is_error: false,
        total_cost_usd: 0.0123,
        duration_ms: 5000,
        duration_api_ms: 4000,
        num_turns: 3,
      },
      state,
    );
    logFile.close();
    const content = await Deno.readTextFile(tmpPath);
    assertEquals(
      content.includes("--- end ---"),
      true,
      "expected --- end --- marker",
    );
    assertEquals(content.includes("status=ok"), true, "expected footer status");
    assertEquals(
      content.includes("duration=5.0s"),
      true,
      "expected footer duration",
    );
    assertEquals(content.includes("turns=3"), true, "expected footer turns");
  } finally {
    await Deno.remove(tmpPath);
  }
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

// --- permission_mode tests ---

Deno.test("buildClaudeArgs — permissionMode emits --permission-mode", () => {
  const args = buildClaudeArgs(
    makeInvokeOpts({ permissionMode: "bypassPermissions" }),
  );
  const idx = args.indexOf("--permission-mode");
  assertEquals(idx >= 0, true, "should contain --permission-mode");
  assertEquals(args[idx + 1], "bypassPermissions");
});

Deno.test("buildClaudeArgs — permissionMode placed before -p", () => {
  const args = buildClaudeArgs(
    makeInvokeOpts({ permissionMode: "plan" }),
  );
  const pmIdx = args.indexOf("--permission-mode");
  const pIdx = args.indexOf("-p");
  assertEquals(
    pmIdx < pIdx,
    true,
    "--permission-mode should appear before -p",
  );
});

Deno.test("buildClaudeArgs — no permissionMode by default", () => {
  const args = buildClaudeArgs(makeInvokeOpts());
  assertEquals(args.includes("--permission-mode"), false);
});

Deno.test("buildClaudeArgs — permissionMode + claudeArgs both present", () => {
  const args = buildClaudeArgs(
    makeInvokeOpts({
      permissionMode: "bypassPermissions",
      claudeArgs: { "--add-dir": "/tmp" },
    }),
  );
  assertEquals(args.includes("--permission-mode"), true);
  assertEquals(args.includes("--add-dir"), true);
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
