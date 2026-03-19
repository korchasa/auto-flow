import { assertEquals } from "@std/assert";
import {
  checkArgs,
  computeCostBars,
  computePhaseStatus,
  computeTimeline,
  type CostBar,
  escHtml,
  groupNodesByPhase,
  printUsage,
  readNodeLog,
  readRunState,
  readStreamLog,
  renderCard,
  renderCostChart,
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
      config_path: ".auto-flow/pipeline.yaml",
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

// --- readStreamLog ---

Deno.test("readStreamLog — returns full content when under limit", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const content = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n");
    await Deno.writeTextFile(`${dir}/stream.log`, content);
    const result = await readStreamLog(`${dir}/stream.log`);
    assertEquals(result, content);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readStreamLog — truncates with marker when over limit", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // 260 lines > 200+50=250
    const lines = Array.from({ length: 260 }, (_, i) => `line${i}`);
    await Deno.writeTextFile(`${dir}/stream.log`, lines.join("\n"));
    const result = await readStreamLog(`${dir}/stream.log`);
    assertEquals(result.includes("--- truncated ---"), true);
    // First 200 lines present
    assertEquals(result.includes("line0"), true);
    assertEquals(result.includes("line199"), true);
    // Line 200 (index 200) is in the truncated middle — not present
    assertEquals(
      result.includes("line200\n") || result.startsWith("line200"),
      false,
    );
    // Last 50 lines present (lines 210–259)
    assertEquals(result.includes("line259"), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readStreamLog — returns empty string for empty file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/stream.log`, "");
    const result = await readStreamLog(`${dir}/stream.log`);
    assertEquals(result, "");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readStreamLog — returns empty string for missing file", async () => {
  const result = await readStreamLog("/nonexistent/path/stream.log");
  assertEquals(result, "");
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

Deno.test("renderCard — with logContent renders inline log <details>", () => {
  const state: NodeState = { status: "completed" };
  const html = renderCard(
    "build",
    state,
    null,
    undefined,
    "log line 1\nlog line 2",
  );
  assertEquals(html.includes('<pre class="log-content">'), true);
  assertEquals(html.includes("log line 1"), true);
  assertEquals(html.includes("log line 2"), true);
  // Must use <details><summary>stream log</summary>
  assertEquals(html.includes("<summary>stream log</summary>"), true);
});

Deno.test("renderCard — without logContent omits inline log viewer", () => {
  const state: NodeState = { status: "completed" };
  const html = renderCard("build", state, null);
  assertEquals(html.includes('class="log-content"'), false);
});

Deno.test("renderCard — logContent is HTML-escaped", () => {
  const state: NodeState = { status: "completed" };
  const html = renderCard(
    "build",
    state,
    null,
    undefined,
    "<script>alert(1)</script>",
  );
  assertEquals(html.includes("<script>"), false);
  assertEquals(html.includes("&lt;script&gt;"), true);
});

// --- renderHtml ---

Deno.test("renderHtml — contains all node cards", () => {
  const state: RunState = {
    run_id: "run-xyz",
    config_path: ".auto-flow/pipeline.yaml",
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

Deno.test("renderHtml — header status class matches run state for completed", () => {
  const state: RunState = {
    run_id: "r",
    config_path: "",
    started_at: "2024-01-01T00:00:00Z",
    status: "completed",
    args: {},
    env: {},
    nodes: {},
  };
  const html = renderHtml(state, {});
  assertEquals(
    html.includes('<strong class="completed">completed</strong>'),
    true,
  );
});

Deno.test("renderHtml — header status class matches run state for running", () => {
  const state: RunState = {
    run_id: "r",
    config_path: "",
    started_at: "2024-01-01T00:00:00Z",
    status: "running",
    args: {},
    env: {},
    nodes: {},
  };
  const html = renderHtml(state, {});
  assertEquals(html.includes('<strong class="running">running</strong>'), true);
});

Deno.test("renderHtml — CSS contains distinct rules for all 4 status values", () => {
  const state: RunState = {
    run_id: "r",
    config_path: "",
    started_at: "2024-01-01T00:00:00Z",
    status: "completed",
    args: {},
    env: {},
    nodes: {},
  };
  const html = renderHtml(state, {});
  // All 4 status selectors must exist as distinct rules
  assertEquals(html.includes("strong.completed{"), true);
  assertEquals(html.includes("strong.running{"), true);
  assertEquals(html.includes("strong.failed{"), true);
  assertEquals(html.includes("strong.aborted{"), true);
  // running must NOT share a combined rule with completed
  assertEquals(html.includes("strong.completed,strong.running"), false);
});

Deno.test("renderHtml — phase status badge rendered when phases provided", () => {
  const state: RunState = {
    run_id: "r",
    config_path: "",
    started_at: "2024-01-01T00:00:00Z",
    status: "completed",
    args: {},
    env: {},
    nodes: {
      spec: { status: "completed" },
    },
  };
  const phases = { plan: ["spec"] };
  const html = renderHtml(state, {}, phases);
  assertEquals(html.includes('class="phase-badge'), true);
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

// --- computeCostBars ---

Deno.test("computeCostBars — proportional widths relative to max cost", () => {
  const state: RunState = {
    run_id: "r",
    config_path: "",
    started_at: "2024-01-01T00:00:00Z",
    status: "completed",
    args: {},
    env: {},
    nodes: {
      cheap: { status: "completed", cost_usd: 1.0 },
      expensive: { status: "completed", cost_usd: 4.0 },
    },
  };
  const bars = computeCostBars(state);
  assertEquals(bars.length, 2);
  const cheap = bars.find((b) => b.nodeId === "cheap")!;
  const expensive = bars.find((b) => b.nodeId === "expensive")!;
  assertEquals(expensive.widthPct, 100);
  assertEquals(cheap.widthPct, 25);
});

Deno.test("computeCostBars — zero-cost nodes excluded", () => {
  const state: RunState = {
    run_id: "r",
    config_path: "",
    started_at: "2024-01-01T00:00:00Z",
    status: "completed",
    args: {},
    env: {},
    nodes: {
      zero: { status: "completed", cost_usd: 0 },
      paid: { status: "completed", cost_usd: 0.5 },
    },
  };
  const bars = computeCostBars(state);
  assertEquals(bars.length, 1);
  assertEquals(bars[0].nodeId, "paid");
});

Deno.test("computeCostBars — empty input returns empty array", () => {
  const state: RunState = {
    run_id: "r",
    config_path: "",
    started_at: "2024-01-01T00:00:00Z",
    status: "completed",
    args: {},
    env: {},
    nodes: {},
  };
  const bars = computeCostBars(state);
  assertEquals(bars.length, 0);
});

// --- renderCostChart ---

Deno.test("renderCostChart — SVG structure with rect and text", () => {
  const bars: CostBar[] = [
    { nodeId: "build", costUsd: 0.5, widthPct: 100 },
  ];
  const html = renderCostChart(bars, 0.5);
  assertEquals(html.includes("<svg"), true);
  assertEquals(html.includes("<rect"), true);
  assertEquals(html.includes("<text"), true);
});

Deno.test("renderCostChart — total cost shown in header", () => {
  const bars: CostBar[] = [
    { nodeId: "build", costUsd: 0.1234, widthPct: 100 },
  ];
  const html = renderCostChart(bars, 0.1234);
  assertEquals(html.includes("0.1234"), true);
});

Deno.test("renderCostChart — labels escaped via escHtml", () => {
  const bars: CostBar[] = [
    { nodeId: "<xss>", costUsd: 0.1, widthPct: 100 },
  ];
  const html = renderCostChart(bars, 0.1);
  assertEquals(html.includes("<xss>"), false);
  assertEquals(html.includes("&lt;xss&gt;"), true);
});

Deno.test("renderCostChart — empty bars produces no-cost-data message", () => {
  const html = renderCostChart([], 0);
  assertEquals(html.includes("No cost data"), true);
  assertEquals(html.includes("<svg"), false);
});

// --- edge cases ---

Deno.test("computeCostBars — single node gets 100% width", () => {
  const state: RunState = {
    run_id: "r",
    config_path: "",
    started_at: "2024-01-01T00:00:00Z",
    status: "completed",
    args: {},
    env: {},
    nodes: {
      only: { status: "completed", cost_usd: 2.5 },
    },
  };
  const bars = computeCostBars(state);
  assertEquals(bars.length, 1);
  assertEquals(bars[0].widthPct, 100);
});

Deno.test("computeCostBars — all-zero costs produces empty chart data", () => {
  const state: RunState = {
    run_id: "r",
    config_path: "",
    started_at: "2024-01-01T00:00:00Z",
    status: "completed",
    args: {},
    env: {},
    nodes: {
      a: { status: "completed", cost_usd: 0 },
      b: { status: "completed", cost_usd: 0 },
    },
  };
  const bars = computeCostBars(state);
  assertEquals(bars.length, 0);
  const html = renderCostChart(bars, 0);
  assertEquals(html.includes("No cost data"), true);
});

Deno.test("renderCostChart — escHtml on labels with special chars", () => {
  const bars: CostBar[] = [
    { nodeId: `a&b"c'`, costUsd: 0.1, widthPct: 100 },
  ];
  const html = renderCostChart(bars, 0.1);
  assertEquals(html.includes(`a&b"c'`), false);
  assertEquals(html.includes("&amp;"), true);
  assertEquals(html.includes("&quot;"), true);
  assertEquals(html.includes("&#39;"), true);
});

Deno.test("renderHtml — cost chart appears between timeline and main", () => {
  const state: RunState = {
    run_id: "run-cost",
    config_path: "",
    started_at: "2024-01-01T00:00:00Z",
    status: "completed",
    args: {},
    env: {},
    nodes: {
      build: { status: "completed", cost_usd: 1.0 },
    },
  };
  const html = renderHtml(state, {});
  const timelineEnd = html.indexOf(
    "</section>",
    html.indexOf('class="timeline"'),
  );
  const costChartStart = html.indexOf('class="cost-chart"');
  const mainStart = html.indexOf("<main>");
  assertEquals(timelineEnd < costChartStart, true);
  assertEquals(costChartStart < mainStart, true);
});

// --- stream log link (issue #49) ---

Deno.test("renderCard — with streamLogHref renders log-link anchor", () => {
  const state: NodeState = { status: "completed" };
  const html = renderCard("build", state, null, "plan/build/stream.log");
  assertEquals(html.includes('<a class="log-link"'), true);
  assertEquals(html.includes('href="plan/build/stream.log"'), true);
  assertEquals(html.includes("stream log"), true);
});

Deno.test("renderCard — without streamLogHref does not render log-link", () => {
  const state: NodeState = { status: "completed" };
  const html = renderCard("build", state, null);
  assertEquals(html.includes("log-link"), false);
  assertEquals(html.includes("stream log"), false);
});

Deno.test("renderHtml — streamLogHrefs threads links to mapped nodes only", () => {
  const state: RunState = {
    run_id: "run-links",
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
  const streamLogHrefs: Record<string, string> = {
    build: "impl/build/stream.log",
  };
  const html = renderHtml(state, {}, undefined, streamLogHrefs);
  // build has a link
  assertEquals(html.includes("impl/build/stream.log"), true);
  // spec does not have a log-link — count occurrences: only 1 log-link anchor
  const linkCount = (html.match(/class="log-link"/g) ?? []).length;
  assertEquals(linkCount, 1);
});

// --- groupNodesByPhase ---

Deno.test("groupNodesByPhase — phased nodes grouped correctly", () => {
  const nodeIds = ["spec", "build", "verify"];
  const phases = { plan: ["spec"], impl: ["build", "verify"] };
  const groups = groupNodesByPhase(nodeIds, phases);
  assertEquals(groups.length, 2);
  assertEquals(groups[0].label, "plan");
  assertEquals(groups[0].ids, ["spec"]);
  assertEquals(groups[1].label, "impl");
  assertEquals(groups[1].ids, ["build", "verify"]);
});

Deno.test("groupNodesByPhase — unphased nodes placed in 'other' group", () => {
  const nodeIds = ["spec", "build", "orphan"];
  const phases = { plan: ["spec"], impl: ["build"] };
  const groups = groupNodesByPhase(nodeIds, phases);
  assertEquals(groups.length, 3);
  assertEquals(groups[2].label, "other");
  assertEquals(groups[2].ids, ["orphan"]);
});

Deno.test("groupNodesByPhase — empty nodeIds returns empty array", () => {
  const groups = groupNodesByPhase([], { plan: ["spec"] });
  assertEquals(groups.length, 0);
});

Deno.test("groupNodesByPhase — no phases config returns single group with all nodeIds and empty label", () => {
  const nodeIds = ["spec", "build"];
  const groups = groupNodesByPhase(nodeIds);
  assertEquals(groups.length, 1);
  assertEquals(groups[0].label, "");
  assertEquals(groups[0].ids, ["spec", "build"]);
});

// --- computePhaseStatus ---

Deno.test("computePhaseStatus — all-pass core + failed always-node", () => {
  const nodeStates: Record<string, NodeState> = {
    build: { status: "completed" },
    notify: { status: "failed" },
  };
  const alwaysNodes = new Set(["notify"]);
  const result = computePhaseStatus(
    ["build", "notify"],
    nodeStates,
    alwaysNodes,
  );
  assertEquals(result.coreStatus, "completed");
  assertEquals(result.alwaysStatus, "failed");
});

Deno.test("computePhaseStatus — failed core + passed always-node", () => {
  const nodeStates: Record<string, NodeState> = {
    build: { status: "failed" },
    notify: { status: "completed" },
  };
  const alwaysNodes = new Set(["notify"]);
  const result = computePhaseStatus(
    ["build", "notify"],
    nodeStates,
    alwaysNodes,
  );
  assertEquals(result.coreStatus, "failed");
  assertEquals(result.alwaysStatus, "completed");
});

Deno.test("computePhaseStatus — mixed core statuses yields running", () => {
  const nodeStates: Record<string, NodeState> = {
    build: { status: "completed" },
    test: { status: "running" },
  };
  const alwaysNodes = new Set<string>();
  const result = computePhaseStatus(["build", "test"], nodeStates, alwaysNodes);
  assertEquals(result.coreStatus, "running");
  assertEquals(result.alwaysStatus, undefined);
});

Deno.test("computePhaseStatus — no always-nodes omits alwaysStatus", () => {
  const nodeStates: Record<string, NodeState> = {
    build: { status: "completed" },
    test: { status: "completed" },
  };
  const alwaysNodes = new Set<string>();
  const result = computePhaseStatus(["build", "test"], nodeStates, alwaysNodes);
  assertEquals(result.coreStatus, "completed");
  assertEquals(result.alwaysStatus, undefined);
});

Deno.test("computePhaseStatus — all nodes are always-nodes: coreStatus is completed", () => {
  const nodeStates: Record<string, NodeState> = {
    notify: { status: "failed" },
  };
  const alwaysNodes = new Set(["notify"]);
  const result = computePhaseStatus(["notify"], nodeStates, alwaysNodes);
  // coreIds is empty → computeStatus([]) = "completed"
  assertEquals(result.coreStatus, "completed");
  assertEquals(result.alwaysStatus, "failed");
});

// --- printUsage ---

Deno.test("printUsage — contains Usage and deno task dashboard", () => {
  const text = printUsage();
  assertEquals(text.includes("Usage:"), true);
  assertEquals(text.includes("deno task dashboard"), true);
});

Deno.test("printUsage — mentions --run-dir option", () => {
  const text = printUsage();
  assertEquals(text.includes("--run-dir"), true);
});

// --- checkArgs ---

Deno.test("checkArgs — --help returns usage text with code 0", () => {
  const result = checkArgs(["--help"]);
  assertEquals(result?.code, 0);
  assertEquals(result?.text.includes("deno task dashboard"), true);
});

Deno.test("checkArgs — -h returns usage text with code 0", () => {
  const result = checkArgs(["-h"]);
  assertEquals(result?.code, 0);
  assertEquals(result?.text.includes("deno task dashboard"), true);
});

Deno.test("checkArgs — --help alongside --run-dir returns help (code 0)", () => {
  const result = checkArgs(["--help", "--run-dir", "/some/path"]);
  assertEquals(result?.code, 0);
  assertEquals(result?.text.includes("deno task dashboard"), true);
});

Deno.test("checkArgs — unknown flag returns error string with code 1", () => {
  const result = checkArgs(["--output", "out.html"]);
  assertEquals(result?.code, 1);
  assertEquals(result?.text.includes("Unknown argument: --output"), true);
  assertEquals(result?.text.includes("--help"), true);
});

Deno.test("checkArgs — valid --run-dir arg returns null (ok)", () => {
  const result = checkArgs(["--run-dir", ".auto-flow/runs/20260101T120000"]);
  assertEquals(result, null);
});

Deno.test("checkArgs — empty args returns null", () => {
  const result = checkArgs([]);
  assertEquals(result, null);
});
