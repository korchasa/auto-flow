import { assertEquals } from "@std/assert";
import {
  escHtml,
  readNodeLog,
  readRunState,
  renderCard,
  renderHtml,
} from "./generate-dashboard.ts";
import type { ClaudeCliOutput, NodeState, RunState } from "../engine/types.ts";

// --- escHtml ---

Deno.test("escHtml — escapes < > & \" '", () => {
  assertEquals(
    escHtml("<script>\"&'"),
    "&lt;script&gt;&quot;&amp;&#39;",
  );
});

Deno.test("escHtml — no-op on safe text", () => {
  assertEquals(escHtml("hello world"), "hello world");
});

// --- readRunState ---

Deno.test("readRunState — parses valid state.json", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const state: RunState = {
      run_id: "test-123",
      config_path: ".sdlc/pipeline.yaml",
      started_at: "2024-01-01T00:00:00.000Z",
      status: "completed",
      args: {},
      env: {},
      nodes: { spec: { status: "completed" } },
    };
    await Deno.writeTextFile(`${dir}/state.json`, JSON.stringify(state));
    const parsed = await readRunState(dir);
    assertEquals(parsed.run_id, "test-123");
    assertEquals(parsed.status, "completed");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readRunState — throws on missing state.json", async () => {
  let threw = false;
  try {
    await readRunState("/nonexistent/path/does-not-exist");
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

// --- readNodeLog ---

Deno.test("readNodeLog — parses valid log JSON", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/logs`);
    const log: ClaudeCliOutput = {
      result: "done",
      session_id: "sess-1",
      total_cost_usd: 0.01,
      duration_ms: 1000,
      duration_api_ms: 800,
      num_turns: 2,
      is_error: false,
    };
    await Deno.writeTextFile(`${dir}/logs/build.json`, JSON.stringify(log));
    const parsed = await readNodeLog(dir, "build");
    assertEquals(parsed?.result, "done");
    assertEquals(parsed?.total_cost_usd, 0.01);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readNodeLog — returns null on missing file", async () => {
  const result = await readNodeLog("/nonexistent", "missing");
  assertEquals(result, null);
});

Deno.test("readNodeLog — returns null on malformed JSON", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/logs`);
    await Deno.writeTextFile(`${dir}/logs/bad.json`, "not json {{{");
    const result = await readNodeLog(dir, "bad");
    assertEquals(result, null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// --- renderCard ---

Deno.test("renderCard — contains <details> for multi-line result", () => {
  const state: NodeState = { status: "completed", duration_ms: 2000 };
  const log: ClaudeCliOutput = {
    result: "line1\nline2\nline3\nline4",
    session_id: "",
    total_cost_usd: 0.05,
    duration_ms: 2000,
    duration_api_ms: 1800,
    num_turns: 3,
    is_error: false,
  };
  const html = renderCard("build", state, log);
  assertEquals(html.includes("<details>"), true);
  assertEquals(html.includes("<summary>"), true);
});

Deno.test("renderCard — no <details> for single-line result", () => {
  const state: NodeState = { status: "completed" };
  const log: ClaudeCliOutput = {
    result: "All checks passed",
    session_id: "",
    total_cost_usd: 0.01,
    duration_ms: 500,
    duration_api_ms: 400,
    num_turns: 1,
    is_error: false,
  };
  const html = renderCard("verify", state, log);
  assertEquals(html.includes("<details>"), false);
  assertEquals(html.includes("All checks passed"), true);
});

Deno.test("renderCard — status badge present", () => {
  const state: NodeState = { status: "failed", error: "something went wrong" };
  const html = renderCard("build", state, null);
  assertEquals(html.includes("failed"), true);
  assertEquals(html.includes("badge"), true);
});

Deno.test("renderCard — displays cost from log", () => {
  const state: NodeState = { status: "completed" };
  const log: ClaudeCliOutput = {
    result: "ok",
    session_id: "",
    total_cost_usd: 0.1234,
    duration_ms: 1000,
    duration_api_ms: 800,
    num_turns: 2,
    is_error: false,
  };
  const html = renderCard("node1", state, log);
  assertEquals(html.includes("0.1234"), true);
});

Deno.test("renderCard — 3-line preview in summary, full text in details body", () => {
  const state: NodeState = { status: "completed" };
  const log: ClaudeCliOutput = {
    result: "A\nB\nC\nD\nE",
    session_id: "",
    total_cost_usd: 0,
    duration_ms: 0,
    duration_api_ms: 0,
    num_turns: 1,
    is_error: false,
  };
  const html = renderCard("n", state, log);
  // Summary contains first 3 lines
  assertEquals(html.includes("A\nB\nC"), true);
  // Full result text present in details body
  assertEquals(html.includes("A\nB\nC\nD\nE"), true);
});

// --- renderHtml ---

Deno.test("renderHtml — contains all node cards", () => {
  const state: RunState = {
    run_id: "run-xyz",
    config_path: ".sdlc/pipeline.yaml",
    started_at: "2024-01-01T00:00:00Z",
    status: "completed",
    args: {},
    env: {},
    nodes: {
      spec: { status: "completed" },
      build: { status: "completed" },
    },
  };
  const logs: Record<string, ClaudeCliOutput | null> = {
    spec: null,
    build: null,
  };
  const html = renderHtml(state, logs);
  assertEquals(html.includes("spec"), true);
  assertEquals(html.includes("build"), true);
  assertEquals(html.includes("run-xyz"), true);
});

Deno.test("renderHtml — phase labels rendered when phases provided", () => {
  const state: RunState = {
    run_id: "run-abc",
    config_path: "",
    started_at: "2024-01-01T00:00:00Z",
    status: "completed",
    args: {},
    env: {},
    nodes: {
      spec: { status: "completed" },
      build: { status: "completed" },
    },
  };
  const phases = { plan: ["spec"], impl: ["build"] };
  const html = renderHtml(state, {}, phases);
  assertEquals(html.includes("plan"), true);
  assertEquals(html.includes("impl"), true);
});

Deno.test("renderHtml — contains run metadata (run_id, started_at, status)", () => {
  const state: RunState = {
    run_id: "run-meta-test",
    config_path: "",
    started_at: "2024-06-01T12:00:00Z",
    status: "failed",
    args: {},
    env: {},
    nodes: {},
  };
  const html = renderHtml(state, {});
  assertEquals(html.includes("run-meta-test"), true);
  assertEquals(html.includes("2024-06-01T12:00:00Z"), true);
  assertEquals(html.includes("failed"), true);
});
