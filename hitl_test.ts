import { assertEquals } from "@std/assert";
import type { HitlConfig } from "./types.ts";
import { runHitlLoop } from "./hitl.ts";
import type { HitlRunOptions } from "./hitl.ts";

// HITL detection tests have moved to hitl-injection_test.ts (observer-based
// detection via runtime-neutral onToolUseObserved hook; ADR-0013, FR-L35).

// --- runHitlLoop tests ---

function makeHitlConfig(): HitlConfig {
  return {
    ask_script: ".flowai-workflow/scripts/hitl-ask.sh",
    check_script: ".flowai-workflow/scripts/hitl-check.sh",
    artifact_source: "pm/01-spec.md",
    poll_interval: 0.01, // fast for tests (10ms)
    timeout: 0.5, // 500ms timeout for tests
    exclude_login: "bot[bot]",
  };
}

function makeBaseOpts(overrides?: Partial<HitlRunOptions>): HitlRunOptions {
  // Per-call tmp dir keeps the FR-E64 audit-artifact append from
  // colliding across tests and pollutes only $TMPDIR.
  const runDir = Deno.makeTempDirSync({ prefix: "flowai-hitl-test-" });
  return {
    config: makeHitlConfig(),
    nodeId: "pm",
    runId: "test-run",
    runDir,
    env: {},
    sessionId: "sess-123",
    question: {
      question: "Which language?",
      options: [{ label: "Go" }, { label: "Python" }],
    },
    node: {
      type: "agent",
      label: "PM",
      agent: "agent-pm",
      prompt: "do something",
    },
    ctx: {
      node_dir: "/tmp/test",
      run_dir: "/tmp/run",
      run_id: "test-run",
      workDir: ".",
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

Deno.test("runHitlLoop — artifact_source template resolved via ctx", async () => {
  const capturedAskArgs: string[] = [];

  const opts = makeBaseOpts({
    config: {
      ...makeHitlConfig(),
      artifact_source: "{{input.specification}}/01-spec.md",
    },
    ctx: {
      node_dir: "/tmp/test",
      run_dir: "/tmp/run",
      run_id: "test-run",
      workDir: ".",
      args: {},
      env: {},
      input: { specification: "/runs/abc/specification" },
    },
    scriptRunner: (path: string, args: string[]) => {
      if (path.includes("ask")) capturedAskArgs.push(...args);
      if (path.includes("check")) {
        return Promise.resolve({ exitCode: 0, stdout: "Go" });
      }
      return Promise.resolve({ exitCode: 0, stdout: "" });
    },
    claudeRunner: (_opts) =>
      Promise.resolve({
        output: {
          result: "OK",
          session_id: "sess-xyz",
          total_cost_usd: 0.01,
          duration_ms: 100,
          duration_api_ms: 80,
          num_turns: 1,
          is_error: false,
        },
      }),
  });

  await runHitlLoop(opts);

  const idx = capturedAskArgs.indexOf("--artifact-source");
  assertEquals(idx !== -1, true);
  assertEquals(
    capturedAskArgs[idx + 1],
    "/runs/abc/specification/01-spec.md",
  );
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
