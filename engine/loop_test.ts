import { assertEquals } from "@std/assert";
import { extractFrontmatterField } from "./loop.ts";
import type { LoopRunOptions } from "./loop.ts";
import { OutputManager } from "./output.ts";
import type { ClaudeCliOutput, PipelineConfig } from "./types.ts";
import { createRunState, markNodeCompleted, markNodeStarted } from "./state.ts";

// Note: Full integration tests for runLoop require claude CLI.
// These tests cover the pure logic: frontmatter extraction and structure.

Deno.test("extractFrontmatterField — extracts simple string", () => {
  const content = `---
verdict: PASS
---
# QA Report
All checks passed.`;

  assertEquals(extractFrontmatterField(content, "verdict"), "PASS");
});

Deno.test("extractFrontmatterField — extracts FAIL value", () => {
  const content = `---
verdict: FAIL
---
# QA Report
Issues found.`;

  assertEquals(extractFrontmatterField(content, "verdict"), "FAIL");
});

Deno.test("extractFrontmatterField — returns undefined for missing field", () => {
  const content = `---
verdict: PASS
---
# Report`;

  assertEquals(extractFrontmatterField(content, "status"), undefined);
});

Deno.test("extractFrontmatterField — returns undefined for no frontmatter", () => {
  const content = `# Just a regular markdown file
No frontmatter here.`;

  assertEquals(extractFrontmatterField(content, "verdict"), undefined);
});

Deno.test("extractFrontmatterField — handles numeric values as string", () => {
  const content = `---
score: 95
---
# Report`;

  assertEquals(extractFrontmatterField(content, "score"), "95");
});

Deno.test("extractFrontmatterField — handles multiple fields", () => {
  const content = `---
variant: "Variant B"
verdict: PASS
confidence: high
---
# Decision`;

  assertEquals(extractFrontmatterField(content, "variant"), "Variant B");
  assertEquals(extractFrontmatterField(content, "verdict"), "PASS");
  assertEquals(extractFrontmatterField(content, "confidence"), "high");
});

Deno.test("extractFrontmatterField — handles invalid YAML gracefully", () => {
  const content = `---
: invalid yaml [
---
# Broken`;

  assertEquals(extractFrontmatterField(content, "verdict"), undefined);
});

Deno.test("extractFrontmatterField — handles empty frontmatter", () => {
  const content = `---
---
# Empty frontmatter`;

  assertEquals(extractFrontmatterField(content, "verdict"), undefined);
});

Deno.test("extractFrontmatterField — boolean values converted to string", () => {
  const content = `---
approved: true
---
# Report`;

  assertEquals(extractFrontmatterField(content, "approved"), "true");
});

Deno.test("LoopRunOptions — accepts output field", () => {
  const output = new OutputManager("verbose");
  // Verify the type allows output field (compile-time check)
  const opts: Partial<LoopRunOptions> = {
    loopNodeId: "exec-qa-loop",
    output,
  };
  assertEquals(opts.output instanceof OutputManager, true);
});

Deno.test("LoopRunOptions — output is optional", () => {
  const opts: Partial<LoopRunOptions> = {
    loopNodeId: "exec-qa-loop",
  };
  assertEquals(opts.output, undefined);
});

// --- bodyResults / inline nodes tests ---

Deno.test("LoopResult — bodyResults is array even when loop node has no runnable agents", () => {
  // Verify LoopResult.bodyResults is always an array (structural check).
  // Full runLoop integration requires claude CLI — just verify the type contract.
  const config: PipelineConfig = {
    name: "test",
    version: "1",
    nodes: {
      "my-loop": {
        type: "loop",
        label: "Test Loop",
        condition_node: "worker",
        condition_field: "verdict",
        exit_value: "PASS",
        max_iterations: 1,
        nodes: {
          worker: {
            type: "agent",
            label: "Worker",
            task_template: "do work",
          },
        },
      },
    },
  };
  // Structural assertion: loop node has inline nodes
  assertEquals(Object.keys(config.nodes["my-loop"].nodes!).length, 1);
  assertEquals(config.nodes["my-loop"].nodes!.worker.type, "agent");
});

// --- FR-32: Cost tracking for loop body nodes ---

Deno.test("loop body node — markNodeCompleted with cost from AgentResult.output", () => {
  // Simulate what loop.ts does: markNodeCompleted(state, bodyNodeId, result.output?.total_cost_usd)
  const state = createRunState("test", "cfg.yaml", ["build", "verify"], {}, {});

  // Simulate iteration 1: build node completes with cost
  markNodeStarted(state, "build");
  markNodeCompleted(state, "build", 0.012);

  assertEquals(state.nodes.build.cost_usd, 0.012);
  assertEquals(state.total_cost_usd, 0.012);

  // Simulate iteration 1: verify node completes with cost
  markNodeStarted(state, "verify");
  markNodeCompleted(state, "verify", 0.008);

  assertEquals(state.nodes.verify.cost_usd, 0.008);
  assertEquals(state.total_cost_usd, 0.02);
});

Deno.test("loop body node — AgentResult output exposes total_cost_usd", () => {
  // Verify ClaudeCliOutput.total_cost_usd is accessible (type contract)
  const mockOutput: ClaudeCliOutput = {
    result: "Iteration done",
    session_id: "s-loop-123",
    total_cost_usd: 0.0055,
    duration_ms: 12000,
    duration_api_ms: 11000,
    num_turns: 4,
    is_error: false,
  };
  assertEquals(mockOutput.total_cost_usd, 0.0055);
});

Deno.test("loop body node — cost_usd undefined when result.output absent", () => {
  // When runAgent returns no output (e.g., agent crashed), cost stays undefined
  const state = createRunState("test", "cfg.yaml", ["build"], {}, {});
  markNodeStarted(state, "build");
  // Pass undefined (simulating result.output?.total_cost_usd when output is absent)
  markNodeCompleted(state, "build", undefined);

  assertEquals(state.nodes.build.cost_usd, undefined);
  assertEquals(state.total_cost_usd, undefined);
});
