// FR-E8: agent-initiated HITL via engine-owned MCP server (hitl-via-engine-mcp).
// Detection helpers live in hitl-injection_test.ts; this file covers
// the runHitlLoop ask/poll/resume cycle and FR-E64 audit append.
import { assertEquals, assertStringIncludes } from "@std/assert";
import type { HitlConfig } from "../types.ts";
import { runHitlLoop } from "./hitl.ts";
import type { HitlRunOptions } from "./hitl.ts";
import { nodeWaiting } from "../engine/node-lifecycle.ts";
import { createRunState } from "../state/state.ts";

// HITL detection tests have moved to hitl-injection_test.ts (observer-based
// detection via runtime-neutral onToolUseObserved hook; hitl-via-engine-mcp, FR-L35).

// --- runHitlLoop tests ---

Deno.test("HITL waiting emits node lifecycle callback", async () => {
  const state = createRunState("hitl-run", "cfg.yaml", ["pm"], {}, {});
  const questionJson = '{"question":"Which language?"}';
  const events: Array<{
    status: string;
    sessionId?: string;
    questionJson?: string;
  }> = [];

  await nodeWaiting(state, "pm", "sess-hitl", questionJson, (event) => {
    events.push({
      status: event.status,
      sessionId: event.metadata.session_id,
      questionJson: event.metadata.question_json,
    });
  });

  assertEquals(events, [{
    status: "waiting",
    sessionId: "sess-hitl",
    questionJson,
  }]);
  assertEquals(state.nodes.pm.status, "waiting");
  assertEquals(state.nodes.pm.session_id, "sess-hitl");
  assertEquals(state.nodes.pm.question_json, questionJson);
});

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

// --- FR-E64: Q+A audit artefact at <nodeDirAbs>/hitl.jsonl ---

Deno.test("runHitlLoop — FR-E64 appends audit record on reply", async () => {
  const tmpRoot = await Deno.makeTempDir({ prefix: "flowai-hitl-audit-" });
  const opts = makeBaseOpts({
    ctx: {
      node_dir: "node-pm",
      run_dir: tmpRoot,
      run_id: "test-run",
      workDir: tmpRoot,
      args: {},
      env: {},
      input: {},
    },
    question: {
      question: "Which language?",
      options: [{ label: "Go" }, { label: "Python" }],
    },
    scriptRunner: (path: string, _args: string[]) => {
      if (path.includes("check")) {
        return Promise.resolve({ exitCode: 0, stdout: "Go" });
      }
      return Promise.resolve({ exitCode: 0, stdout: "" });
    },
    claudeRunner: (_o) =>
      Promise.resolve({
        output: {
          result: "ok",
          session_id: "sess-r1",
          total_cost_usd: 0,
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          is_error: false,
        },
      }),
  });

  await runHitlLoop(opts);

  const auditPath = `${tmpRoot}/node-pm/hitl.jsonl`;
  const body = await Deno.readTextFile(auditPath);
  const lines = body.split("\n").filter((l) => l.trim());
  assertEquals(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assertEquals(rec.round, 0);
  assertEquals(rec.reply, "Go");
  assertEquals(rec.question.question, "Which language?");
  assertEquals(typeof rec.ts, "string");
});

Deno.test("runHitlLoop — FR-E64 round counter survives existing file", async () => {
  const tmpRoot = await Deno.makeTempDir({ prefix: "flowai-hitl-audit-" });
  await Deno.mkdir(`${tmpRoot}/node-pm`, { recursive: true });
  // Pre-seed two prior rounds (simulating crash-resumed run).
  await Deno.writeTextFile(
    `${tmpRoot}/node-pm/hitl.jsonl`,
    JSON.stringify({ round: 0, prior: true }) + "\n" +
      JSON.stringify({ round: 1, prior: true }) + "\n",
  );

  const opts = makeBaseOpts({
    ctx: {
      node_dir: "node-pm",
      run_dir: tmpRoot,
      run_id: "test-run",
      workDir: tmpRoot,
      args: {},
      env: {},
      input: {},
    },
    question: { question: "Resume?" },
    scriptRunner: (path: string, _args: string[]) => {
      if (path.includes("check")) {
        return Promise.resolve({ exitCode: 0, stdout: "yes" });
      }
      return Promise.resolve({ exitCode: 0, stdout: "" });
    },
    claudeRunner: (_o) =>
      Promise.resolve({
        output: {
          result: "ok",
          session_id: "sess-r2",
          total_cost_usd: 0,
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          is_error: false,
        },
      }),
  });

  await runHitlLoop(opts);

  const lines = (await Deno.readTextFile(`${tmpRoot}/node-pm/hitl.jsonl`))
    .split("\n").filter((l) => l.trim());
  assertEquals(lines.length, 3);
  const last = JSON.parse(lines[2]);
  assertEquals(last.round, 2); // continued from existing line count
  assertEquals(last.reply, "yes");
});

// --- FR-E75: local HITL answer inbox channel ---

Deno.test("FR-E75 runHitlLoop — local inbox reply resumes and is consumed", async () => {
  const tmpRoot = await Deno.makeTempDir({ prefix: "flowai-hitl-inbox-" });
  // Pre-place the local inbox file the operator's host IDE / CLI would write
  // via commands.deliverHumanAnswer. check_script NEVER replies, proving the
  // inbox path is what drives the resume.
  await Deno.mkdir(`${tmpRoot}/.hitl-inbox`, { recursive: true });
  await Deno.writeTextFile(`${tmpRoot}/.hitl-inbox/pm.txt`, "монетизация\n");

  let resumePrompt: string | undefined;
  const opts = makeBaseOpts({
    runDir: tmpRoot,
    ctx: {
      node_dir: "pm",
      run_dir: tmpRoot,
      run_id: "test-run",
      workDir: tmpRoot,
      args: {},
      env: {},
      input: {},
    },
    scriptRunner: (path: string, _args: string[]) =>
      Promise.resolve({ exitCode: path.includes("check") ? 1 : 0, stdout: "" }),
    claudeRunner: (o) => {
      resumePrompt = o.taskPrompt;
      return Promise.resolve({
        output: {
          result: "ok",
          session_id: "s1",
          total_cost_usd: 0,
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          is_error: false,
        },
      });
    },
  });

  const result = await runHitlLoop(opts, true /* skipAsk */);
  assertEquals(result.success, true);
  assertEquals(resumePrompt, "монетизация");

  // Consumed: file removed so a later HITL round won't re-answer with it.
  let exists = true;
  try {
    await Deno.stat(`${tmpRoot}/.hitl-inbox/pm.txt`);
  } catch {
    exists = false;
  }
  assertEquals(exists, false);

  // FR-E64 audit append happens for the local reply too.
  const audit = await Deno.readTextFile(`${tmpRoot}/pm/hitl.jsonl`);
  const rec = JSON.parse(audit.trim().split("\n").pop()!);
  assertEquals(rec.reply, "монетизация");

  await Deno.remove(tmpRoot, { recursive: true });
});

Deno.test("FR-E75 runHitlLoop — local inbox wins over check_script reply", async () => {
  const tmpRoot = await Deno.makeTempDir({ prefix: "flowai-hitl-inbox-" });
  await Deno.mkdir(`${tmpRoot}/.hitl-inbox`, { recursive: true });
  await Deno.writeTextFile(`${tmpRoot}/.hitl-inbox/pm.txt`, "local-choice");

  let checkCalls = 0;
  let resumePrompt: string | undefined;
  const opts = makeBaseOpts({
    runDir: tmpRoot,
    ctx: {
      node_dir: "pm",
      run_dir: tmpRoot,
      run_id: "test-run",
      workDir: tmpRoot,
      args: {},
      env: {},
      input: {},
    },
    scriptRunner: (path: string, _args: string[]) => {
      if (path.includes("check")) {
        checkCalls++;
        return Promise.resolve({ exitCode: 0, stdout: "telegram-choice" });
      }
      return Promise.resolve({ exitCode: 0, stdout: "" });
    },
    claudeRunner: (o) => {
      resumePrompt = o.taskPrompt;
      return Promise.resolve({
        output: {
          result: "ok",
          session_id: "s2",
          total_cost_usd: 0,
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          is_error: false,
        },
      });
    },
  });

  const result = await runHitlLoop(opts, true /* skipAsk */);
  assertEquals(result.success, true);
  assertEquals(resumePrompt, "local-choice"); // inbox, not telegram
  assertEquals(checkCalls, 0); // check_script not consulted once inbox hits

  await Deno.remove(tmpRoot, { recursive: true });
});

Deno.test(
  "runHitlLoop — surfaces ask_script stderr in error message on non-zero exit",
  async () => {
    // Without surfacing stderr, callers see only `ask_script failed with
    // exit code 1` and cannot diagnose the underlying cause (e.g. invalid
    // bot token, chat-not-found, network timeout). The runner already
    // pipes stderr; this test pins the contract that hitl.ts MUST include
    // it in the returned error message so the post-mortem dashboard and
    // engine logs reveal what actually broke.
    const opts = makeBaseOpts({
      scriptRunner: (path: string, _args: string[]) => {
        if (path.includes("ask")) {
          return Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr: "ERROR: sendMessage failed: chat not found",
          });
        }
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      },
      claudeRunner: () =>
        Promise.resolve({
          output: {
            result: "",
            session_id: "sess-x",
            total_cost_usd: 0,
            duration_ms: 0,
            duration_api_ms: 0,
            num_turns: 0,
            is_error: false,
          },
        }),
    });

    const result = await runHitlLoop(opts);
    assertEquals(result.success, false);
    assertStringIncludes(result.error ?? "", "exit code 1");
    assertStringIncludes(
      result.error ?? "",
      "chat not found",
      "ask_script stderr must appear in the error message",
    );
  },
);
