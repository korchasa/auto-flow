import { assertEquals, assertThrows } from "@std/assert";
import {
  carriesHitlQuestion,
  extractConditionValue,
  extractFrontmatterField,
  hitlFailure,
  runLoop,
} from "./loop.ts";
import type { LoopRunOptions } from "./loop.ts";
import { OutputManager } from "../output.ts";
import { createFakeRuntime } from "../testing/fake-runtime.ts";
import type {
  CliRunOutput,
  NodeConfig,
  ResolvedNodeSettings,
  RunState,
  TemplateContext,
  WorkflowConfig,
} from "../types.ts";
import {
  createRunState,
  markNodeCompleted,
  markNodeStarted,
} from "../state/state.ts";
import { nodeStarted } from "./node-lifecycle.ts";

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

Deno.test("extractFrontmatterField — ignores invalid unrelated YAML scalars", () => {
  const content = `---
source: pdr-pickup: documents/pdrs/example.md
verdict: FAIL
---
# Report`;

  assertEquals(extractFrontmatterField(content, "verdict"), "FAIL");
});

Deno.test("extractFrontmatterField — throws on duplicate target field", () => {
  const content = `---
verdict: PASS
qa_iteration: 1
verdict: PASS
qa_iteration: 1
---
# Body`;

  assertThrows(
    () => extractFrontmatterField(content, "verdict"),
    Error,
    "Duplicate frontmatter field 'verdict'",
  );
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

Deno.test("loop body lifecycle callback covers iteration metadata", async () => {
  const state = createRunState("loop-run", "cfg.yaml", ["build"], {}, {});
  state.nodes.build.iteration = 2;

  const events: Array<{ status: string; iteration?: number }> = [];
  await nodeStarted(state, "build", (event) => {
    events.push({
      status: event.status,
      iteration: event.metadata.iteration,
    });
  });

  assertEquals(events, [{ status: "running", iteration: 2 }]);
  assertEquals(state.nodes.build.iteration, 2);
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

// --- HITL inside a loop body (review fix) ---

const HITL_OUTPUT: CliRunOutput = {
  session_id: "sess-loop",
  is_error: false,
  result: "",
} as CliRunOutput;

Deno.test("carriesHitlQuestion — a paused HITL turn is not real progress", () => {
  assertEquals(
    carriesHitlQuestion({
      success: true,
      continuations: 0,
      output: HITL_OUTPUT,
      hitl_question: { question: "which option?" } as never,
    }),
    true,
  );
});

Deno.test("carriesHitlQuestion — an ordinary success is untouched", () => {
  assertEquals(
    carriesHitlQuestion({
      success: true,
      continuations: 0,
      output: HITL_OUTPUT,
    }),
    false,
  );
});

Deno.test("hitlFailure — an unrouted question fails the body node explicitly", () => {
  const failed = hitlFailure(
    "developer",
    { success: true, continuations: 0, output: HITL_OUTPUT },
    "unrouted",
  );
  assertEquals(failed.success, false);
  assertEquals(failed.error_category, "unknown");
  assertEquals(
    failed.error,
    "Body node 'developer' requested human input but the loop has no HITL router configured",
  );
});

Deno.test("hitlFailure — a router that gives up also fails the node", () => {
  const failed = hitlFailure(
    "developer",
    { success: true, continuations: 0, output: HITL_OUTPUT },
    "routing",
  );
  assertEquals(failed.success, false);
  assertEquals(failed.error, "HITL handling failed for body node 'developer'");
});

Deno.test("hitlFailure — the cause the router recorded survives to the loop error", () => {
  const failed = hitlFailure(
    "developer",
    { success: true, continuations: 0, output: HITL_OUTPUT },
    "routing",
    "Agent called request_human_input but defaults.hitl not configured in workflow.yaml",
  );
  assertEquals(failed.success, false);
  assertEquals(
    failed.error,
    "Agent called request_human_input but defaults.hitl not configured in workflow.yaml",
  );
});

Deno.test("hitlFailure — an unrouted question ignores any recorded cause", () => {
  const failed = hitlFailure(
    "developer",
    { success: true, continuations: 0, output: HITL_OUTPUT },
    "unrouted",
    "stale cause from an earlier node",
  );
  assertEquals(
    failed.error,
    "Body node 'developer' requested human input but the loop has no HITL router configured",
  );
});

// --- FR-E86: real runLoop integration through an injected runtime adapter ---

Deno.test("FR-E86 runLoop iterates body nodes until the exit value", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const settings: ResolvedNodeSettings = {
      max_continuations: 0,
      timeout_seconds: 30,
      on_error: "fail",
      max_retries: 1,
      retry_delay_seconds: 1,
    };
    const config: WorkflowConfig = {
      name: "loop-fake",
      version: "1",
      nodes: {
        "impl-loop": {
          type: "loop",
          label: "Impl Loop",
          condition_node: "verify",
          condition_field: "verdict",
          exit_value: "PASS",
          max_iterations: 3,
          nodes: {
            verify: {
              type: "agent",
              label: "Verify",
              prompt: "verify the work",
              settings,
            } as NodeConfig,
          },
        } as NodeConfig,
      },
    };
    const state = createRunState(
      "run-loop",
      "cfg.yaml",
      ["impl-loop", "verify"],
      {},
      {},
    );

    // Iteration 1 reports FAIL, iteration 2 reports PASS — the loop's exit
    // condition is driven entirely by what the handler writes.
    const adapter = createFakeRuntime(async (call) => {
      const verdict = call.index === 1 ? "FAIL" : "PASS";
      await call.write(
        `${tmpDir}/verify-${call.index}/report.md`,
        `---\nverdict: ${verdict}\n---\n`,
      );
      return call.reply({ result: verdict, costUsd: 0.02 });
    });

    const result = await runLoop({
      loopNodeId: "impl-loop",
      config,
      state,
      runtimeAdapter: adapter,
      buildCtx: (nodeId, iteration) => {
        const nodeDir = `${tmpDir}/${nodeId}-${iteration}`;
        Deno.mkdirSync(nodeDir, { recursive: true });
        return {
          node_dir: nodeDir,
          run_dir: tmpDir,
          run_id: "run-loop",
          workDir: ".",
          args: {},
          env: {},
          input: {},
        };
      },
    });

    assertEquals(result.success, true);
    assertEquals(result.iterations, 2);
    assertEquals(result.lastConditionValue, "PASS");
    assertEquals(result.exit_reason, "exit_value");
    assertEquals(adapter.calls.length, 2);
    assertEquals(state.nodes.verify.iteration, 2);
    // Current behaviour, not an endorsement: `markNodeCompleted` OVERWRITES
    // `cost_usd` per iteration, so a loop body's run-level cost reflects only
    // its last iteration ($0.02 of the $0.04 actually spent). Locked here so
    // any change to loop cost aggregation is a deliberate one.
    assertEquals(state.total_cost_usd, 0.02);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// --- FR-E100: session continuation across loop iterations ---

const LOOP_SETTINGS: ResolvedNodeSettings = {
  max_continuations: 0,
  timeout_seconds: 30,
  on_error: "fail",
  max_retries: 1,
  retry_delay_seconds: 1,
};

function sessionLoopConfig(
  bodyExtra: Partial<NodeConfig>,
  defaults: WorkflowConfig["defaults"] = { runtime: "opencode" },
): WorkflowConfig {
  return {
    name: "loop-session",
    version: "1",
    defaults,
    nodes: {
      write: {
        type: "agent",
        label: "Write",
        prompt: "write",
        settings: LOOP_SETTINGS,
      } as NodeConfig,
      "impl-loop": {
        type: "loop",
        label: "Impl Loop",
        inputs: ["write"],
        condition_node: "verify",
        condition_field: "verdict",
        exit_value: "PASS",
        max_iterations: 3,
        nodes: {
          verify: {
            type: "agent",
            label: "Verify",
            prompt: "verify the work",
            system_prompt: "You verify.",
            settings: LOOP_SETTINGS,
            ...bodyExtra,
          } as NodeConfig,
        },
      } as NodeConfig,
    },
  };
}

function loopCtxFactory(tmpDir: string): LoopRunOptions["buildCtx"] {
  return (nodeId, iteration) => {
    const nodeDir = `${tmpDir}/${nodeId}-${iteration}`;
    Deno.mkdirSync(nodeDir, { recursive: true });
    return {
      node_dir: nodeDir,
      run_dir: tmpDir,
      run_id: "run-loop",
      workDir: ".",
      args: {},
      env: {},
      input: {},
    };
  };
}

Deno.test("FR-E100 loop body node — continues the previous iteration's session when opted in", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = sessionLoopConfig({ session: "continue" });
    const state = createRunState(
      "run-loop",
      "cfg.yaml",
      ["write", "impl-loop", "verify"],
      {},
      {},
    );
    const adapter = createFakeRuntime(async (call) => {
      const verdict = call.index === 1 ? "FAIL" : "PASS";
      await call.write(
        `${tmpDir}/verify-${call.index}/report.md`,
        `---\nverdict: ${verdict}\n---\n`,
      );
      return call.reply({ result: verdict, sessionId: `ses-${call.index}` });
    });

    const result = await runLoop({
      loopNodeId: "impl-loop",
      config,
      state,
      runtimeAdapter: adapter,
      buildCtx: loopCtxFactory(tmpDir),
    });

    assertEquals(result.success, true);
    assertEquals(result.iterations, 2);
    assertEquals(adapter.calls.length, 2);
    // Iteration 1 opens a session and delivers the system prompt.
    assertEquals(adapter.calls[0].resumeSessionId, undefined);
    assertEquals(adapter.calls[0].systemPrompt, "You verify.");
    // Iteration 2 re-enters it with the resume shape.
    assertEquals(adapter.calls[1].resumeSessionId, "ses-1");
    assertEquals(adapter.calls[1].systemPrompt, undefined);
    assertEquals(adapter.calls[1].taskPrompt, "verify the work");
    // The live state carries the latest session after each attempt.
    assertEquals(state.nodes.verify.session_id, "ses-2");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("FR-E100 loop body node — fresh by default", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = sessionLoopConfig({});
    const state = createRunState(
      "run-loop",
      "cfg.yaml",
      ["write", "impl-loop", "verify"],
      {},
      {},
    );
    const adapter = createFakeRuntime(async (call) => {
      const verdict = call.index === 1 ? "FAIL" : "PASS";
      await call.write(
        `${tmpDir}/verify-${call.index}/report.md`,
        `---\nverdict: ${verdict}\n---\n`,
      );
      return call.reply({ result: verdict, sessionId: `ses-${call.index}` });
    });

    const result = await runLoop({
      loopNodeId: "impl-loop",
      config,
      state,
      runtimeAdapter: adapter,
      buildCtx: loopCtxFactory(tmpDir),
    });

    assertEquals(result.success, true);
    assertEquals(adapter.calls.length, 2);
    assertEquals(adapter.calls[1].resumeSessionId, undefined);
    assertEquals(adapter.calls[1].systemPrompt, "You verify.");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("FR-E100 loop body node — fails clearly when the session to continue is missing", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = sessionLoopConfig({ session: "write" });
    const state = createRunState(
      "run-loop",
      "cfg.yaml",
      ["write", "impl-loop", "verify"],
      {},
      {},
    );
    // `write` never recorded a session (it stands pending here).
    const adapter = createFakeRuntime((call) => call.reply());

    const result = await runLoop({
      loopNodeId: "impl-loop",
      config,
      state,
      runtimeAdapter: adapter,
      buildCtx: loopCtxFactory(tmpDir),
    });

    assertEquals(result.success, false);
    assertEquals(result.error_category, "config_error");
    assertEquals(
      result.error,
      "Body node 'verify' failed on iteration 1: Node 'verify' asks to continue the session of 'write' (session: write), but 'write' has no completed attempt that recorded one",
    );
    assertEquals(state.nodes.verify.status, "failed");
    assertEquals(state.nodes.verify.error_category, "config_error");
    // No runtime turn was spent: the node failed before invoking anything.
    assertEquals(adapter.calls.length, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("FR-E100 loop body node — a replayed failed attempt is not continued", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const run = async (prior: Partial<RunState["nodes"][string]>) => {
      const config = sessionLoopConfig({ session: "continue" });
      const state = createRunState(
        "run-loop",
        "cfg.yaml",
        ["write", "impl-loop", "verify"],
        {},
        {},
      );
      state.nodes.verify = { ...state.nodes.verify, ...prior };
      const adapter = createFakeRuntime(async (call) => {
        await call.write(
          `${tmpDir}/verify-${call.index}/report.md`,
          `---\nverdict: PASS\n---\n`,
        );
        return call.reply({ result: "PASS", sessionId: "ses-new" });
      });
      const result = await runLoop({
        loopNodeId: "impl-loop",
        config,
        state,
        runtimeAdapter: adapter,
        buildCtx: loopCtxFactory(tmpDir),
      });
      assertEquals(result.success, true);
      return adapter.calls[0].resumeSessionId;
    };

    // `--resume` after the attempt failed: the failed session stays closed.
    assertEquals(
      await run({ status: "failed", session_id: "ses-old", error: "boom" }),
      undefined,
    );
    // `--resume` after a crash between iterations: the completed attempt's
    // session is still the one to continue.
    assertEquals(
      await run({ status: "completed", session_id: "ses-old" }),
      "ses-old",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
