import { assertEquals } from "@std/assert";
import { OutputManager } from "./output.ts";
import type { RunSummary } from "./output.ts";

/** Capture output lines from an OutputManager. */
function createCapture(): { lines: string[]; writer: (text: string) => void } {
  const lines: string[] = [];
  return { lines, writer: (text: string) => lines.push(text) };
}

Deno.test("OutputManager — constructs with default verbosity", () => {
  const out = new OutputManager();
  assertEquals(typeof out, "object");
});

Deno.test("OutputManager — constructs with quiet verbosity", () => {
  const out = new OutputManager("quiet");
  assertEquals(typeof out, "object");
});

Deno.test("OutputManager — constructs with verbose verbosity", () => {
  const out = new OutputManager("verbose");
  assertEquals(typeof out, "object");
});

Deno.test("RunSummary — structure", () => {
  const summary: RunSummary = {
    name: "test-workflow",
    runId: "20260308T143022",
    status: "completed",
    durationMs: 125000,
    total: 9,
    completed: 9,
    failed: 0,
    skipped: 0,
  };

  assertEquals(summary.total, 9);
  assertEquals(summary.completed, 9);
  assertEquals(summary.status, "completed");
});

Deno.test("RunSummary — with failures", () => {
  const summary: RunSummary = {
    name: "test-workflow",
    runId: "20260308T143022",
    status: "failed",
    durationMs: 60000,
    total: 9,
    completed: 4,
    failed: 1,
    skipped: 4,
  };

  assertEquals(summary.failed, 1);
  assertEquals(summary.skipped, 4);
});

// --- Verbose methods tests ---

Deno.test("verbosePrompt — emits prompt in verbose mode", () => {
  const cap = createCapture();
  const out = new OutputManager("verbose", cap.writer);
  out.verbosePrompt("developer", "Do task #42");
  assertEquals(cap.lines.length > 0, true);
  assertEquals(cap.lines.some((l) => l.includes("developer")), true);
  assertEquals(cap.lines.some((l) => l.includes("Do task #42")), true);
});

Deno.test("verbosePrompt — no-op in normal mode", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  out.verbosePrompt("developer", "Do task #42");
  assertEquals(cap.lines.length, 0);
});

Deno.test("verboseInputs — emits input list in verbose mode", () => {
  const cap = createCapture();
  const out = new OutputManager("verbose", cap.writer);
  out.verboseInputs("developer", [
    { path: "spec/01-spec.md", sizeBytes: 1024 },
    { path: "plan/02-plan.md", sizeBytes: 2048 },
  ]);
  assertEquals(cap.lines.length > 0, true);
  assertEquals(cap.lines.some((l) => l.includes("01-spec.md")), true);
  assertEquals(cap.lines.some((l) => l.includes("2048")), true);
});

Deno.test("verboseInputs — no-op in quiet mode", () => {
  const cap = createCapture();
  const out = new OutputManager("quiet", cap.writer);
  out.verboseInputs("developer", [
    { path: "spec/01-spec.md", sizeBytes: 1024 },
  ]);
  assertEquals(cap.lines.length, 0);
});

Deno.test("verboseValidation — emits rule results in verbose mode", () => {
  const cap = createCapture();
  const out = new OutputManager("verbose", cap.writer);
  out.verboseValidation("qa", [
    { rule: "file_exists", passed: true },
    { rule: "file_not_empty", passed: false, detail: "File is empty" },
  ]);
  assertEquals(cap.lines.length > 0, true);
  assertEquals(cap.lines.some((l) => l.includes("file_exists")), true);
  assertEquals(cap.lines.some((l) => l.includes("FAIL")), true);
});

Deno.test("verboseValidation — no-op in normal mode", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  out.verboseValidation("qa", [
    { rule: "file_exists", passed: true },
  ]);
  assertEquals(cap.lines.length, 0);
});

Deno.test("verboseContinuation — emits continuation context in verbose mode", () => {
  const cap = createCapture();
  const out = new OutputManager("verbose", cap.writer);
  out.verboseContinuation("developer", 2, 3, [
    "file_not_empty: output.md is empty",
  ]);
  assertEquals(cap.lines.length > 0, true);
  assertEquals(cap.lines.some((l) => l.includes("2")), true);
  assertEquals(cap.lines.some((l) => l.includes("3")), true);
  assertEquals(cap.lines.some((l) => l.includes("output.md")), true);
});

// --- nodeResult tests (FR-E15) ---

Deno.test("nodeResult — emits result line in normal mode", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  out.nodeResult("developer", {
    result: "Implementation complete",
    session_id: "s1",
    total_cost_usd: 0.0123,
    duration_ms: 45000,
    duration_api_ms: 40000,
    num_turns: 7,
    is_error: false,
  });
  const joined = cap.lines.join("");
  assertEquals(joined.includes("RESULT:"), true);
  assertEquals(joined.includes("Implementation complete"), true);
  assertEquals(joined.includes("cost=$0.0123"), true);
  assertEquals(joined.includes("duration=45s"), true);
  assertEquals(joined.includes("turns=7"), true);
});

Deno.test("nodeResult — suppressed in quiet mode", () => {
  const cap = createCapture();
  const out = new OutputManager("quiet", cap.writer);
  out.nodeResult("developer", {
    result: "Done",
    session_id: "s1",
    total_cost_usd: 0.01,
    duration_ms: 5000,
    duration_api_ms: 4000,
    num_turns: 3,
    is_error: false,
  });
  assertEquals(cap.lines.length, 0);
});

Deno.test("nodeResult — emits result line in verbose mode", () => {
  const cap = createCapture();
  const out = new OutputManager("verbose", cap.writer);
  out.nodeResult("qa", {
    result: "All tests passed",
    session_id: "s2",
    total_cost_usd: 0.0050,
    duration_ms: 10000,
    duration_api_ms: 9000,
    num_turns: 2,
    is_error: false,
  });
  const joined = cap.lines.join("");
  assertEquals(joined.includes("RESULT:"), true);
  assertEquals(joined.includes("All tests passed"), true);
  assertEquals(joined.includes("turns=2"), true);
});

Deno.test("nodeResult — skips empty and whitespace-only lines in result", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  out.nodeResult("developer", {
    result: "First\n\n   \nSecond",
    session_id: "s1",
    total_cost_usd: 0.01,
    duration_ms: 1000,
    duration_api_ms: 900,
    num_turns: 1,
    is_error: false,
  });
  assertEquals(cap.lines.some((l) => l === "  First\n"), true);
  assertEquals(cap.lines.some((l) => l === "  Second\n"), true);
  // No blank content lines emitted
  assertEquals(cap.lines.filter((l) => l.trim() === "").length, 0);
});

Deno.test("nodeResult — includes multiple non-empty lines in excerpt", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  out.nodeResult("developer", {
    result: "First line\nSecond line\nThird line",
    session_id: "s1",
    total_cost_usd: 0.01,
    duration_ms: 2000,
    duration_api_ms: 1800,
    num_turns: 4,
    is_error: false,
  });
  const joined = cap.lines.join("");
  assertEquals(joined.includes("First line"), true);
  assertEquals(joined.includes("Second line"), true);
  assertEquals(joined.includes("Third line"), true);
});

Deno.test("nodeResult — handles empty result string", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  out.nodeResult("developer", {
    result: "",
    session_id: "s1",
    total_cost_usd: 0.0,
    duration_ms: 500,
    duration_api_ms: 450,
    num_turns: 1,
    is_error: false,
  });
  const joined = cap.lines.join("");
  assertEquals(joined.includes("RESULT:"), true);
  assertEquals(joined.includes("cost=$0.0000"), true);
});

Deno.test("nodeResult — multi-line format: header, indented content, footer", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  out.nodeResult("developer", {
    result: "Line one\nLine two",
    session_id: "s1",
    total_cost_usd: 0.0050,
    duration_ms: 3000,
    duration_api_ms: 2800,
    num_turns: 2,
    is_error: false,
  });
  // Header line contains RESULT:
  assertEquals(cap.lines.some((l) => l.includes("RESULT:")), true);
  // Content lines are indented with 2 spaces
  assertEquals(cap.lines.some((l) => l === "  Line one\n"), true);
  assertEquals(cap.lines.some((l) => l === "  Line two\n"), true);
  // Footer contains cost, duration, turns
  assertEquals(cap.lines.some((l) => l.includes("cost=$0.0050")), true);
  assertEquals(cap.lines.some((l) => l.includes("duration=3s")), true);
  assertEquals(cap.lines.some((l) => l.includes("turns=2")), true);
});

// --- nodeOutput gating tests ---

Deno.test("nodeOutput — shown in verbose mode", () => {
  const cap = createCapture();
  const out = new OutputManager("verbose", cap.writer);
  out.nodeOutput("developer", "[stream] text: hello");
  assertEquals(cap.lines.length > 0, true);
  assertEquals(cap.lines.some((l) => l.includes("[stream] text: hello")), true);
});

Deno.test("nodeOutput — shown in semi-verbose mode", () => {
  const cap = createCapture();
  const out = new OutputManager("semi-verbose", cap.writer);
  out.nodeOutput("developer", "[stream] text: hello");
  assertEquals(cap.lines.length > 0, true);
  assertEquals(cap.lines.some((l) => l.includes("[stream] text: hello")), true);
});

Deno.test("nodeOutput — hidden in normal mode", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  out.nodeOutput("developer", "[stream] text: hello");
  assertEquals(cap.lines.length, 0);
});

Deno.test("nodeOutput — hidden in quiet mode", () => {
  const cap = createCapture();
  const out = new OutputManager("quiet", cap.writer);
  out.nodeOutput("developer", "[stream] text: hello");
  assertEquals(cap.lines.length, 0);
});

Deno.test("OutputManager — constructs with semi-verbose verbosity", () => {
  const out = new OutputManager("semi-verbose");
  assertEquals(typeof out, "object");
});

Deno.test("OutputManager — verbosityLevel getter returns correct value", () => {
  const out = new OutputManager("semi-verbose");
  assertEquals(out.verbosityLevel, "semi-verbose");
});

Deno.test("OutputManager — verbosityLevel returns verbose when verbose", () => {
  const out = new OutputManager("verbose");
  assertEquals(out.verbosityLevel, "verbose");
});

// --- AC8: Default mode (verbose=false) emits zero verbose output ---

Deno.test("AC8 — default mode emits zero output from all verbose methods", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);

  out.verbosePrompt("node1", "Some prompt text");
  out.verboseInputs("node1", [
    { path: "a.md", sizeBytes: 100 },
    { path: "b.md", sizeBytes: 200 },
  ]);
  out.verboseValidation("node1", [
    { rule: "file_exists", passed: true },
    { rule: "file_not_empty", passed: false, detail: "empty" },
  ]);
  out.verboseContinuation("node1", 1, 3, ["validation failed"]);

  assertEquals(
    cap.lines.length,
    0,
    "Default mode must produce zero verbose output",
  );
});

// --- summary() with nodeResults tests (FR-E22) ---

Deno.test("summary — renders node results when nodeResults present", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  const stats: RunSummary = {
    name: "test-workflow",
    runId: "20260308T143022",
    status: "completed",
    durationMs: 60000,
    total: 2,
    completed: 2,
    failed: 0,
    skipped: 0,
    nodeResults: {
      developer: "Implemented feature X | Added tests",
      qa: "All checks passed",
    },
  };
  out.summary(stats);
  const joined = cap.lines.join("");
  assertEquals(joined.includes("developer"), true);
  assertEquals(joined.includes("Implemented feature X"), true);
  assertEquals(joined.includes("qa"), true);
  assertEquals(joined.includes("All checks passed"), true);
});

Deno.test("summary — omits node results section when nodeResults absent", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  const stats: RunSummary = {
    name: "test-workflow",
    runId: "20260308T143022",
    status: "completed",
    durationMs: 60000,
    total: 2,
    completed: 2,
    failed: 0,
    skipped: 0,
  };
  out.summary(stats);
  const joined = cap.lines.join("");
  // Should still have the standard fields
  assertEquals(joined.includes("Workflow:"), true);
  assertEquals(joined.includes("Status:"), true);
  // No extra result lines
  assertEquals(joined.includes("RESULT:"), false);
});

Deno.test("dry-run plan — renders levels and labels without transport suffix", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  out.dryRunPlan([["a", "b"]], { a: "Agent A", b: "Agent B" });
  const joined = cap.lines.join("");
  assertEquals(/-\s+a:\s+Agent A\n/.test(joined), true);
  assertEquals(/-\s+b:\s+Agent B\n/.test(joined), true);
  assertEquals(joined.includes("[transport"), false);
});

Deno.test("summary — renders standard fields correctly", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  const stats: RunSummary = {
    name: "my-workflow",
    runId: "20260308T143022",
    status: "failed",
    durationMs: 125000,
    total: 5,
    completed: 3,
    failed: 1,
    skipped: 1,
  };
  out.summary(stats);
  const joined = cap.lines.join("");
  assertEquals(joined.includes("my-workflow"), true);
  assertEquals(joined.includes("20260308T143022"), true);
  assertEquals(joined.includes("failed"), true);
  assertEquals(joined.includes("3/5 completed"), true);
  assertEquals(joined.includes("1 failed"), true);
  assertEquals(joined.includes("1 skipped"), true);
});
