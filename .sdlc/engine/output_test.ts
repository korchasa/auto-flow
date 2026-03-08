import { assertEquals } from "jsr:@std/assert";
import { OutputManager } from "./output.ts";
import type { RunSummary } from "./output.ts";

// OutputManager writes to stderr which is hard to capture in tests.
// These tests verify the public API compiles and basic structure.
// Visual output is verified manually.

Deno.test("OutputManager — constructs with default verbosity", () => {
  const out = new OutputManager();
  // Should not throw
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
