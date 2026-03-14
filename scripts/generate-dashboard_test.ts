import { assertEquals } from "@std/assert";
import {
  computeTimeline,
  escHtml,
  readNodeLog,
  readRunState,
  renderCard,
  renderHtml,
  renderTimeline,
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

Deno.test("renderCard — no <details> and no crash for empty/undefined result", () => {
  const state: NodeState = { status: "running" };
  const html = renderCard("mynode", state, null);
  assertEquals(html.includes("<details>"), false);
  assertEquals(html.includes("mynode"), true);
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

Deno.test("renderHtml — includes timeline section", () => {
  const state: RunState = {
    run_id: "run-tl",
    config_path: "",
    started_at: "2024-01-01T00:00:00Z",
    status: "completed",
    args: {},
    env: {},
    nodes: {
      build: {
        status: "completed",
        started_at: "2024-01-01T00:00:00Z",
        duration_ms: 5000,
      },
    },
  };
  const html = renderHtml(state, {});
  assertEquals(html.includes('class="timeline"'), true);
});

Deno.test("renderHtml — timeline appears between header and main", () => {
  const state: RunState = {
    run_id: "run-order",
    config_path: "",
    started_at: "2024-01-01T00:00:00Z",
    status: "completed",
    args: {},
    env: {},
    nodes: {
      build: {
        status: "completed",
        started_at: "2024-01-01T00:00:00Z",
        duration_ms: 1000,
      },
    },
  };
  const html = renderHtml(state, {});
  const headerEnd = html.indexOf("</header>");
  const timelineStart = html.indexOf('class="timeline"');
  const mainStart = html.indexOf("<main>");
  assertEquals(headerEnd < timelineStart, true);
  assertEquals(timelineStart < mainStart, true);
});

// --- computeTimeline ---

Deno.test("computeTimeline — normal multi-node bar calculation", () => {
  // Two nodes: A starts at t=0 runs 3s, B starts at t=3s runs 7s
  // Total: 10s. A: offset=0%, width=30%. B: offset=30%, width=70%
  const state: RunState = {
    run_id: "r1",
    config_path: "",
    started_at: "2024-01-01T00:00:00.000Z",
    status: "completed",
    args: {},
    env: {},
    nodes: {
      nodeA: {
        status: "completed",
        started_at: "2024-01-01T00:00:00.000Z",
        duration_ms: 3000,
      },
      nodeB: {
        status: "completed",
        started_at: "2024-01-01T00:00:03.000Z",
        duration_ms: 7000,
      },
    },
  };
  const bars = computeTimeline(state);
  assertEquals(bars.length, 2);
  const a = bars.find((b) => b.nodeId === "nodeA")!;
  const bBar = bars.find((b) => b.nodeId === "nodeB")!;
  assertEquals(a.offsetPct, 0);
  assertEquals(Math.round(a.widthPct), 30);
  assertEquals(Math.round(bBar.offsetPct), 30);
  assertEquals(Math.round(bBar.widthPct), 70);
});

Deno.test("computeTimeline — single node: offset 0%, width 100%", () => {
  const state: RunState = {
    run_id: "r2",
    config_path: "",
    started_at: "2024-01-01T00:00:00.000Z",
    status: "completed",
    args: {},
    env: {},
    nodes: {
      only: {
        status: "completed",
        started_at: "2024-01-01T00:00:00.000Z",
        duration_ms: 5000,
      },
    },
  };
  const bars = computeTimeline(state);
  assertEquals(bars.length, 1);
  assertEquals(bars[0].offsetPct, 0);
  assertEquals(bars[0].widthPct, 100);
  assertEquals(bars[0].isBottleneck, true);
});

Deno.test("computeTimeline — omits nodes with missing timing", () => {
  const state: RunState = {
    run_id: "r3",
    config_path: "",
    started_at: "2024-01-01T00:00:00.000Z",
    status: "completed",
    args: {},
    env: {},
    nodes: {
      withTiming: {
        status: "completed",
        started_at: "2024-01-01T00:00:00.000Z",
        duration_ms: 1000,
      },
      noStart: { status: "pending" },
      noDuration: { status: "running", started_at: "2024-01-01T00:00:00.000Z" },
    },
  };
  const bars = computeTimeline(state);
  assertEquals(bars.length, 1);
  assertEquals(bars[0].nodeId, "withTiming");
});

Deno.test("computeTimeline — bottleneck is node with max duration_ms", () => {
  const state: RunState = {
    run_id: "r4",
    config_path: "",
    started_at: "2024-01-01T00:00:00.000Z",
    status: "completed",
    args: {},
    env: {},
    nodes: {
      fast: {
        status: "completed",
        started_at: "2024-01-01T00:00:00.000Z",
        duration_ms: 1000,
      },
      slow: {
        status: "completed",
        started_at: "2024-01-01T00:00:01.000Z",
        duration_ms: 9000,
      },
    },
  };
  const bars = computeTimeline(state);
  const fast = bars.find((b) => b.nodeId === "fast")!;
  const slow = bars.find((b) => b.nodeId === "slow")!;
  assertEquals(fast.isBottleneck, false);
  assertEquals(slow.isBottleneck, true);
});

Deno.test("computeTimeline — returns empty array when no nodes have timing", () => {
  const state: RunState = {
    run_id: "r5",
    config_path: "",
    started_at: "2024-01-01T00:00:00.000Z",
    status: "running",
    args: {},
    env: {},
    nodes: {
      pending: { status: "pending" },
      running: { status: "running" },
    },
  };
  const bars = computeTimeline(state);
  assertEquals(bars.length, 0);
});

// --- renderTimeline ---

Deno.test("renderTimeline — contains timeline-container and timeline-row", () => {
  const bars = [
    {
      nodeId: "build",
      offsetPct: 0,
      widthPct: 100,
      durationMs: 5000,
      isBottleneck: true,
    },
  ];
  const html = renderTimeline(bars);
  assertEquals(html.includes("timeline-container"), true);
  assertEquals(html.includes("timeline-row"), true);
});

Deno.test("renderTimeline — bottleneck class applied to bottleneck bar", () => {
  const bars = [
    {
      nodeId: "slow",
      offsetPct: 0,
      widthPct: 100,
      durationMs: 10000,
      isBottleneck: true,
    },
    {
      nodeId: "fast",
      offsetPct: 0,
      widthPct: 10,
      durationMs: 1000,
      isBottleneck: false,
    },
  ];
  const html = renderTimeline(bars);
  assertEquals(html.includes("timeline-bottleneck"), true);
  // fast node should NOT have bottleneck class — verify slow is bottleneck
  const bottleneckCount = (html.match(/timeline-bottleneck/g) ?? []).length;
  assertEquals(bottleneckCount, 1);
});

Deno.test("renderTimeline — labels sanitized via escHtml", () => {
  const bars = [
    {
      nodeId: "<xss>",
      offsetPct: 0,
      widthPct: 100,
      durationMs: 1000,
      isBottleneck: true,
    },
  ];
  const html = renderTimeline(bars);
  assertEquals(html.includes("<xss>"), false);
  assertEquals(html.includes("&lt;xss&gt;"), true);
});

Deno.test("renderTimeline — empty bars produces graceful empty state", () => {
  const html = renderTimeline([]);
  assertEquals(html.includes("timeline-empty"), true);
  // Should not contain a timeline-container (no bars to show)
  assertEquals(html.includes("timeline-container"), false);
});
