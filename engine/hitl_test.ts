import { assertEquals } from "@std/assert";
import type { ClaudeCliOutput, HitlConfig } from "./types.ts";
import { detectHitlRequest, runHitlLoop } from "./hitl.ts";
import type { HitlRunOptions } from "./hitl.ts";

// --- detectHitlRequest tests ---

Deno.test("detectHitlRequest — returns null when no permission_denials", () => {
  const output: ClaudeCliOutput = {
    result: "done",
    session_id: "sess-1",
    total_cost_usd: 0.05,
    duration_ms: 1000,
    duration_api_ms: 800,
    num_turns: 1,
    is_error: false,
  };
  assertEquals(detectHitlRequest(output), null);
});

Deno.test("detectHitlRequest — returns null when permission_denials has no AskUserQuestion", () => {
  const output: ClaudeCliOutput = {
    result: "done",
    session_id: "sess-1",
    total_cost_usd: 0.05,
    duration_ms: 1000,
    duration_api_ms: 800,
    num_turns: 1,
    is_error: false,
    permission_denials: [
      { tool_name: "Bash", tool_input: { command: "rm -rf /" } },
    ],
  };
  assertEquals(detectHitlRequest(output), null);
});

Deno.test("detectHitlRequest — returns HitlQuestion when AskUserQuestion present", () => {
  const output: ClaudeCliOutput = {
    result: "done",
    session_id: "sess-1",
    total_cost_usd: 0.05,
    duration_ms: 1000,
    duration_api_ms: 800,
    num_turns: 1,
    is_error: false,
    permission_denials: [
      {
        tool_name: "AskUserQuestion",
        tool_input: {
          questions: [{
            question: "Which language?",
            header: "Language Choice",
            options: [
              { label: "Go", description: "Fast compiled" },
              { label: "Python", description: "Universal" },
            ],
            multiSelect: false,
          }],
        },
      },
    ],
  };
  const q = detectHitlRequest(output);
  assertEquals(q !== null, true);
  assertEquals(q!.question, "Which language?");
  assertEquals(q!.header, "Language Choice");
  assertEquals(q!.options!.length, 2);
  assertEquals(q!.options![0].label, "Go");
});

Deno.test("detectHitlRequest — handles flat tool_input (no questions wrapper)", () => {
  const output: ClaudeCliOutput = {
    result: "done",
    session_id: "sess-1",
    total_cost_usd: 0.05,
    duration_ms: 1000,
    duration_api_ms: 800,
    num_turns: 1,
    is_error: false,
    permission_denials: [
      {
        tool_name: "AskUserQuestion",
        tool_input: {
          question: "What is your name?",
        },
      },
    ],
  };
  const q = detectHitlRequest(output);
  assertEquals(q !== null, true);
  assertEquals(q!.question, "What is your name?");
});

// --- runHitlLoop tests ---

function makeHitlConfig(): HitlConfig {
  return {
    ask_script: ".auto-flow/scripts/hitl-ask.sh",
    check_script: ".auto-flow/scripts/hitl-check.sh",
    artifact_source: "pm/01-spec.md",
    poll_interval: 0.01, // fast for tests (10ms)
    timeout: 0.5, // 500ms timeout for tests
    exclude_login: "bot[bot]",
  };
}

function makeBaseOpts(overrides?: Partial<HitlRunOptions>): HitlRunOptions {
  return {
    config: makeHitlConfig(),
    nodeId: "pm",
    runId: "test-run",
    runDir: "/tmp/run",
    env: {},
    sessionId: "sess-123",
    question: {
      question: "Which language?",
      options: [{ label: "Go" }, { label: "Python" }],
    },
    node: {
      type: "agent",
      label: "PM",
      prompt: ".auto-flow/agents/agent-pm/SKILL.md",
      task_template: "do something",
    },
    ctx: {
      node_dir: "/tmp/test",
      run_dir: "/tmp/run",
      run_id: "test-run",
      args: {},
      env: {},
      input: {},
    },
    settings: {
      max_continuations: 3,
      timeout_seconds: 1800,
      on_error: "fail",
      max_retries: 3,
      retry_delay_seconds: 5,
    },
    ...overrides,
  };
}

Deno.test("runHitlLoop — invokes ask_script with correct args", async () => {
  const calls: { path: string; args: string[] }[] = [];

  const opts = makeBaseOpts({
    scriptRunner: (path: string, args: string[]) => {
      calls.push({ path, args });
      if (path.includes("check")) {
        return Promise.resolve({ exitCode: 0, stdout: "Go" });
      }
      return Promise.resolve({ exitCode: 0, stdout: "" });
    },
    claudeRunner: (_opts) =>
      Promise.resolve({
        output: {
          result: "Great choice!",
          session_id: "sess-456",
          total_cost_usd: 0.03,
          duration_ms: 500,
          duration_api_ms: 400,
          num_turns: 1,
          is_error: false,
        },
      }),
  });

  const result = await runHitlLoop(opts);

  // ask_script was called
  const askCall = calls.find((c) => c.path.includes("ask"));
  assertEquals(askCall !== undefined, true);
  assertEquals(askCall!.args.includes("--run-dir"), true);
  assertEquals(askCall!.args.includes("--artifact-source"), true);
  assertEquals(askCall!.args.includes("--run-id"), true);
  assertEquals(askCall!.args.includes("--node-id"), true);
  assertEquals(askCall!.args.includes("--question-json"), true);

  assertEquals(result.success, true);
});

Deno.test("runHitlLoop — poll exits on check exit-0 with reply", async () => {
  let checkCalls = 0;

  const opts = makeBaseOpts({
    scriptRunner: (path: string, _args: string[]) => {
      if (path.includes("check")) {
        checkCalls++;
        if (checkCalls >= 2) {
          return Promise.resolve({ exitCode: 0, stdout: "Python" });
        }
        return Promise.resolve({ exitCode: 1, stdout: "" });
      }
      return Promise.resolve({ exitCode: 0, stdout: "" });
    },
    claudeRunner: (_opts) =>
      Promise.resolve({
        output: {
          result: "Python it is!",
          session_id: "sess-789",
          total_cost_usd: 0.03,
          duration_ms: 500,
          duration_api_ms: 400,
          num_turns: 1,
          is_error: false,
        },
      }),
  });

  const result = await runHitlLoop(opts);
  assertEquals(result.success, true);
  assertEquals(checkCalls, 2);
});

Deno.test("runHitlLoop — timeout returns failure", async () => {
  const opts = makeBaseOpts({
    config: { ...makeHitlConfig(), timeout: 0.05 }, // 50ms
    scriptRunner: (path: string, _args: string[]) => {
      if (path.includes("check")) {
        return Promise.resolve({ exitCode: 1, stdout: "" }); // never reply
      }
      return Promise.resolve({ exitCode: 0, stdout: "" });
    },
  });

  const result = await runHitlLoop(opts);
  assertEquals(result.success, false);
  assertEquals(result.error!.includes("timeout"), true);
});

Deno.test("runHitlLoop — skipAsk=true skips ask invocation", async () => {
  const calls: string[] = [];

  const opts = makeBaseOpts({
    scriptRunner: (path: string, _args: string[]) => {
      calls.push(path);
      if (path.includes("check")) {
        return Promise.resolve({ exitCode: 0, stdout: "Answer" });
      }
      return Promise.resolve({ exitCode: 0, stdout: "" });
    },
    claudeRunner: (_opts) =>
      Promise.resolve({
        output: {
          result: "OK",
          session_id: "sess-abc",
          total_cost_usd: 0.03,
          duration_ms: 500,
          duration_api_ms: 400,
          num_turns: 1,
          is_error: false,
        },
      }),
  });

  const result = await runHitlLoop(opts, true);
  assertEquals(result.success, true);

  // ask_script should NOT have been called
  const askCalls = calls.filter((p) => p.includes("ask"));
  assertEquals(askCalls.length, 0);
});
