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
    name: "test-pipeline",
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
    name: "test-pipeline",
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
  out.verbosePrompt("executor", "Do task #42");
  assertEquals(cap.lines.length > 0, true);
  assertEquals(cap.lines.some((l) => l.includes("executor")), true);
  assertEquals(cap.lines.some((l) => l.includes("Do task #42")), true);
});

Deno.test("verbosePrompt — no-op in normal mode", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  out.verbosePrompt("executor", "Do task #42");
  assertEquals(cap.lines.length, 0);
});

Deno.test("verboseInputs — emits input list in verbose mode", () => {
  const cap = createCapture();
  const out = new OutputManager("verbose", cap.writer);
  out.verboseInputs("executor", [
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
  out.verboseInputs("executor", [
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
  out.verboseContinuation("executor", 2, 3, [
    "file_not_empty: output.md is empty",
  ]);
  assertEquals(cap.lines.length > 0, true);
  assertEquals(cap.lines.some((l) => l.includes("2")), true);
  assertEquals(cap.lines.some((l) => l.includes("3")), true);
  assertEquals(cap.lines.some((l) => l.includes("output.md")), true);
});

Deno.test("verboseSafety — emits safety results in verbose mode", () => {
  const cap = createCapture();
  const out = new OutputManager("verbose", cap.writer);
  out.verboseSafety(
    "executor",
    ["src/main.ts", ".github/ci.yml"],
    ["Out-of-scope: .github/ci.yml"],
  );
  assertEquals(cap.lines.length > 0, true);
  assertEquals(cap.lines.some((l) => l.includes("src/main.ts")), true);
  assertEquals(cap.lines.some((l) => l.includes("Out-of-scope")), true);
});

Deno.test("verboseSafety — no-op in normal mode", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  out.verboseSafety("executor", ["src/main.ts"], []);
  assertEquals(cap.lines.length, 0);
});

Deno.test("verboseCommit — emits commit details in verbose mode", () => {
  const cap = createCapture();
  const out = new OutputManager("verbose", cap.writer);
  out.verboseCommit(
    "executor",
    ["src/main.ts", "src/util.ts"],
    "sdlc(executor): run-1 — Executor",
    "agent/18",
  );
  assertEquals(cap.lines.length > 0, true);
  assertEquals(cap.lines.some((l) => l.includes("src/main.ts")), true);
  assertEquals(cap.lines.some((l) => l.includes("agent/18")), true);
  assertEquals(cap.lines.some((l) => l.includes("sdlc(executor)")), true);
});

Deno.test("verboseCommit — no-op in quiet mode", () => {
  const cap = createCapture();
  const out = new OutputManager("quiet", cap.writer);
  out.verboseCommit("executor", ["src/main.ts"], "msg", "main");
  assertEquals(cap.lines.length, 0);
});

// --- AC8: Default mode (verbose=false) emits zero verbose output ---

Deno.test("AC8 — default mode emits zero output from all 6 verbose methods", () => {
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
  out.verboseSafety("node1", ["src/main.ts"], ["Out-of-scope: .github/ci.yml"]);
  out.verboseCommit("node1", ["src/main.ts"], "commit msg", "agent/42");

  assertEquals(
    cap.lines.length,
    0,
    "Default mode must produce zero verbose output",
  );
});
