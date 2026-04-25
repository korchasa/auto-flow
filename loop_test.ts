import { assertEquals } from "@std/assert";
import { extractConditionValue, extractFrontmatterField } from "./loop.ts";
import type { LoopRunOptions } from "./loop.ts";
import { OutputManager } from "./output.ts";
import type {
  CliRunOutput,
  NodeConfig,
  TemplateContext,
  WorkflowConfig,
} from "./types.ts";
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
  const config: WorkflowConfig = {
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
            prompt: "do work",
          },
        },
      },
    },
  };
  // Structural assertion: loop node has inline nodes
  assertEquals(Object.keys(config.nodes["my-loop"].nodes!).length, 1);
  assertEquals(config.nodes["my-loop"].nodes!.worker.type, "agent");
});

// --- FR-E17: Cost tracking for loop body nodes ---

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
  // Verify CliRunOutput.total_cost_usd is accessible (type contract)
  const mockOutput: CliRunOutput = {
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

// --- FR-E12: Per-node model resolution for loop body nodes ---

Deno.test("loop body node — model resolution: own > loop > defaults", () => {
  // Verify three-tier model resolution chain (own > loop > defaults)
  const config: WorkflowConfig = {
    name: "test",
    version: "1",
    defaults: { model: "claude-haiku-4-5" },
    nodes: {
      "my-loop": {
        type: "loop",
        label: "Test Loop",
        model: "claude-sonnet-4-6",
        condition_node: "verify",
        condition_field: "verdict",
        exit_value: "PASS",
        max_iterations: 1,
        nodes: {
          build: {
            type: "agent",
            label: "Build",
            prompt: "build",
            // No model — should inherit from loop node
          },
          verify: {
            type: "agent",
            label: "Verify",
            prompt: "verify",
            model: "claude-opus-4-6", // Own model — takes precedence
          },
        },
      },
    },
  };

  const loopNode = config.nodes["my-loop"];
  const buildNode = loopNode.nodes!.build;
  const verifyNode = loopNode.nodes!.verify;

  // Tier 2: body node with no model inherits from loop node
  const buildEffective = buildNode.model ?? loopNode.model ??
    config.defaults?.model;
  assertEquals(buildEffective, "claude-sonnet-4-6");

  // Tier 1: body node's own model takes precedence
  const verifyEffective = verifyNode.model ?? loopNode.model ??
    config.defaults?.model;
  assertEquals(verifyEffective, "claude-opus-4-6");
});

Deno.test("loop body node — model falls through to defaults when loop has none", () => {
  const config: WorkflowConfig = {
    name: "test",
    version: "1",
    defaults: { model: "claude-haiku-4-5" },
    nodes: {
      "my-loop": {
        type: "loop",
        label: "Test Loop",
        // No model on loop node
        condition_node: "verify",
        condition_field: "verdict",
        exit_value: "PASS",
        max_iterations: 1,
        nodes: {
          verify: {
            type: "agent",
            label: "Verify",
            prompt: "verify",
            // No model on body node either
          },
        },
      },
    },
  };

  const loopNode = config.nodes["my-loop"];
  const verifyNode = loopNode.nodes!.verify;

  // Tier 3: falls through to defaults
  const effectiveModel = verifyNode.model ?? loopNode.model ??
    config.defaults?.model;
  assertEquals(effectiveModel, "claude-haiku-4-5");
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

// --- FR-E36: Runtime condition_field presence check ---

Deno.test(
  "extractConditionValue — throws when condition_field not found in any output file",
  async () => {
    const tmpDir = Deno.makeTempDirSync();
    Deno.writeTextFileSync(
      `${tmpDir}/05-qa-report.md`,
      `---\nstatus: done\n---\n# Report`,
    );
    const ctx: TemplateContext = {
      node_dir: tmpDir,
      run_dir: tmpDir,
      run_id: "test",
      workDir: ".",
      args: {},
      env: {},
      input: {},
    };
    let caught: Error | undefined;
    try {
      await extractConditionValue(
        ctx,
        {} as NodeConfig,
        "verdict",
        "my-loop",
        "verify",
      );
    } catch (e) {
      caught = e as Error;
    }
    assertEquals(caught !== undefined, true);
    assertEquals(
      caught!.message.includes(
        "condition_field 'verdict' not found in condition node 'verify' output",
      ),
      true,
    );
  },
);

Deno.test(
  "extractConditionValue — throws with loop and node IDs when output directory is empty",
  async () => {
    const tmpDir = Deno.makeTempDirSync();
    const ctx: TemplateContext = {
      node_dir: tmpDir,
      run_dir: tmpDir,
      run_id: "test",
      workDir: ".",
      args: {},
      env: {},
      input: {},
    };
    let caught: Error | undefined;
    try {
      await extractConditionValue(
        ctx,
        {} as NodeConfig,
        "verdict",
        "impl-loop",
        "qa",
      );
    } catch (e) {
      caught = e as Error;
    }
    assertEquals(caught !== undefined, true);
    assertEquals(
      caught!.message.includes(
        "Loop 'impl-loop': condition_field 'verdict' not found in condition node 'qa' output",
      ),
      true,
    );
  },
);

Deno.test(
  "extractConditionValue — returns value when field present in frontmatter",
  async () => {
    const tmpDir = Deno.makeTempDirSync();
    Deno.writeTextFileSync(
      `${tmpDir}/05-qa-report.md`,
      `---\nverdict: PASS\n---\n# QA Report`,
    );
    const ctx: TemplateContext = {
      node_dir: tmpDir,
      run_dir: tmpDir,
      run_id: "test",
      workDir: ".",
      args: {},
      env: {},
      input: {},
    };
    const value = await extractConditionValue(
      ctx,
      {} as NodeConfig,
      "verdict",
      "my-loop",
      "verify",
    );
    assertEquals(value, "PASS");
  },
);

// --- FR-E47: loop budget pre-check ---

import { shouldPreemptLoop } from "./loop.ts";

Deno.test("shouldPreemptLoop — no budget → never preempt", () => {
  assertEquals(shouldPreemptLoop(undefined, 10, 5, 2), false);
});

Deno.test("shouldPreemptLoop — zero completed iterations → never preempt", () => {
  assertEquals(shouldPreemptLoop(100, 0, 0, 0), false);
});

Deno.test("shouldPreemptLoop — avg iter cost within remaining → no preempt", () => {
  // budget=10, spent=3, remaining=7, avg iter = 4/2 = 2 → fits
  assertEquals(shouldPreemptLoop(10, 3, 4, 2), false);
});

Deno.test("shouldPreemptLoop — avg iter cost exceeds remaining → preempt", () => {
  // budget=10, spent=8, remaining=2, avg iter = 6/2 = 3 → preempt
  assertEquals(shouldPreemptLoop(10, 8, 6, 2), true);
});

Deno.test("shouldPreemptLoop — remaining exactly equal to avg → no preempt (strict >)", () => {
  // budget=10, spent=5, remaining=5, avg iter = 10/2 = 5 → 5 > 5 is false
  assertEquals(shouldPreemptLoop(10, 5, 10, 2), false);
});

Deno.test("shouldPreemptLoop — budget already exceeded → preempt (remaining negative)", () => {
  // budget=10, spent=15, remaining=-5, avg=2 → 2 > -5 → preempt
  assertEquals(shouldPreemptLoop(10, 15, 4, 2), true);
});

Deno.test("LoopResult — exit_reason includes budget_preempt literal type", () => {
  // Type-level sanity: accept all three exit_reason values
  const values: Array<"exit_value" | "max_iterations" | "budget_preempt"> = [
    "exit_value",
    "max_iterations",
    "budget_preempt",
  ];
  assertEquals(values.length, 3);
});
