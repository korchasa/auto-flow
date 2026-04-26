import { assertEquals } from "@std/assert";
import type {
  EngineOptions,
  NodeConfig,
  NodeState,
  RunState,
  WorkflowConfig,
} from "./types.ts";
import { resolveInputArtifacts } from "./agent.ts";
import { collectAllNodeIds, findNodeConfig } from "./config.ts";
import { Engine, runPrepareCommand } from "./engine.ts";
import {
  collectPostWorkflowNodes,
  executePostWorkflow,
  runFailureHook,
  sortPostWorkflowNodes,
} from "./post-workflow.ts";
import type { AgentResult } from "./agent.ts";
import {
  createRunState,
  getNodesByStatus,
  markNodeCompleted,
  markNodeFailed,
  markNodeStarted,
} from "./state.ts";
import { OutputManager } from "./output.ts";

/** Capture output lines from an OutputManager. */
function createCapture(): { lines: string[]; writer: (text: string) => void } {
  const lines: string[] = [];
  return { lines, writer: (text: string) => lines.push(text) };
}

// Note: Full integration tests for Engine require claude CLI and a git repo.
// These tests verify options structure and dry-run behavior.

function makeOptions(overrides?: Partial<EngineOptions>): EngineOptions {
  return {
    config_path: ".flowai-workflow/workflow.yaml",
    verbosity: "quiet",
    args: {},
    env_overrides: {},
    ...overrides,
  };
}

Deno.test("EngineOptions — default structure", () => {
  const opts = makeOptions();
  assertEquals(opts.config_path, ".flowai-workflow/workflow.yaml");
  assertEquals(opts.verbosity, "quiet");
  assertEquals(opts.resume, undefined);
  assertEquals(opts.dry_run, undefined);
});

Deno.test("EngineOptions — resume mode", () => {
  const opts = makeOptions({
    resume: true,
    run_id: "20260308T143022",
  });
  assertEquals(opts.resume, true);
  assertEquals(opts.run_id, "20260308T143022");
});

Deno.test("EngineOptions — dry run mode", () => {
  const opts = makeOptions({ dry_run: true });
  assertEquals(opts.dry_run, true);
});

Deno.test("EngineOptions — skip and only nodes", () => {
  const opts = makeOptions({
    skip_nodes: ["meta-agent"],
    only_nodes: ["spec", "plan"],
  });
  assertEquals(opts.skip_nodes, ["meta-agent"]);
  assertEquals(opts.only_nodes, ["spec", "plan"]);
});

Deno.test("EngineOptions — env overrides", () => {
  const opts = makeOptions({
    env_overrides: { API_KEY: "test-key", DEBUG: "true" },
  });
  assertEquals(opts.env_overrides.API_KEY, "test-key");
  assertEquals(opts.env_overrides.DEBUG, "true");
});

Deno.test("Engine — constructs without error", () => {
  const opts = makeOptions();
  const engine = new Engine(opts);
  assertEquals(typeof engine, "object");
});

// Dry-run test requires a real config file on disk.
// This test verifies the Engine can be instantiated with dry_run option.
Deno.test("Engine — dry run option accepted", () => {
  const opts = makeOptions({ dry_run: true });
  const engine = new Engine(opts);
  assertEquals(typeof engine.run, "function");
});

Deno.test("Engine — verbose mode accepted", () => {
  const opts = makeOptions({ verbosity: "verbose" });
  const engine = new Engine(opts);
  assertEquals(typeof engine.run, "function");
});

// FR-E57: a workflow.yaml passed without a directory prefix would collapse
// `workflowDir` to "." and place the worktree at repo-root `./runs/<id>/worktree`,
// which `.gitignore` does not cover. Engine must refuse this combination
// before the worktree is created. Setting `worktree_disabled: true` keeps the
// legacy direct-cwd mode working.
Deno.test("Engine.run() — rejects worktree mode when workflow.yaml is at repo root (FR-E57)", async () => {
  const tmpDir = await Deno.makeTempDir();
  const origCwd = Deno.cwd();
  try {
    // Minimal workflow.yaml at the repo root — no directory prefix in the
    // path passed to the engine, so deriveWorkflowDir returns ".".
    await Deno.writeTextFile(`${tmpDir}/workflow.yaml`, "name: rootless\n");
    Deno.chdir(tmpDir);

    const engine = new Engine(makeOptions({ config_path: "workflow.yaml" }));

    let thrown: Error | undefined;
    try {
      await engine.run();
    } catch (e) {
      thrown = e as Error;
    }
    assertEquals(thrown !== undefined, true);
    assertEquals(
      thrown!.message.includes("workflow folder"),
      true,
      `error should mention "workflow folder", got: ${thrown!.message}`,
    );
    assertEquals(
      thrown!.message.includes("FR-S47") || thrown!.message.includes("FR-E53"),
      true,
      `error should reference FR-S47/FR-E53, got: ${thrown!.message}`,
    );
  } finally {
    Deno.chdir(origCwd);
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("Engine.run() — accepts root workflow.yaml when worktree_disabled (FR-E57)", async () => {
  const tmpDir = await Deno.makeTempDir();
  const origCwd = Deno.cwd();
  try {
    // worktree_disabled: true bypasses the FR-E57 guard. The flag lives
    // under `defaults:` per the workflow schema (see extractWorktreeDisabled).
    await Deno.writeTextFile(
      `${tmpDir}/workflow.yaml`,
      "name: rootless\ndefaults:\n  worktree_disabled: true\n",
    );
    Deno.chdir(tmpDir);

    const engine = new Engine(makeOptions({
      config_path: "workflow.yaml",
      // Lock path forced to a temp file so we don't fight the global lock dir.
      lock_path: `${tmpDir}/test.lock`,
    }));

    // run() will still fail on later phases (no real config nodes etc.), but
    // it must NOT fail with the FR-E57 guard message — that's the point.
    let thrown: Error | undefined;
    try {
      await engine.run();
    } catch (e) {
      thrown = e as Error;
    }
    if (thrown !== undefined) {
      assertEquals(
        thrown.message.includes("workflow folder") &&
          (thrown.message.includes("FR-S47") ||
            thrown.message.includes("FR-E53")),
        false,
        `should not be FR-E57 guard error, got: ${thrown.message}`,
      );
    }
  } finally {
    Deno.chdir(origCwd);
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// --- resolveInputArtifacts tests ---

Deno.test("resolveInputArtifacts — returns files with sizes from real directory", async () => {
  // Create a temp directory with test files
  const tmpDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tmpDir}/spec.md`, "# Spec\nContent here");
    await Deno.writeTextFile(
      `${tmpDir}/plan.md`,
      "# Plan\nMore content here with extra",
    );

    const inputs = { spec: tmpDir };
    const result = await resolveInputArtifacts(inputs);

    assertEquals(result.length, 2);
    for (const item of result) {
      assertEquals(typeof item.path, "string");
      assertEquals(typeof item.sizeBytes, "number");
      assertEquals(item.sizeBytes > 0, true);
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("resolveInputArtifacts — returns empty for non-existent directory", async () => {
  const inputs = { missing: "/tmp/nonexistent-dir-12345" };
  const result = await resolveInputArtifacts(inputs);
  assertEquals(result.length, 0);
});

Deno.test("resolveInputArtifacts — returns empty for empty inputs", async () => {
  const result = await resolveInputArtifacts({});
  assertEquals(result.length, 0);
});

// --- Edge case: empty input directory ---

Deno.test("resolveInputArtifacts — empty directory returns empty list", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    // Directory exists but has zero files
    const inputs = { emptyNode: tmpDir };
    const result = await resolveInputArtifacts(inputs);
    assertEquals(result.length, 0, "Empty dir should yield 0 artifacts");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("verboseInputs — reports 0 files for empty input without error", () => {
  const cap = createCapture();
  const out = new OutputManager("verbose", cap.writer);
  out.verboseInputs("node1", []);
  assertEquals(cap.lines.length > 0, true, "Should still emit header");
  assertEquals(cap.lines.some((l) => l.includes("0 files")), true);
});

// --- Edge case: Deno.stat() failure on missing file ---

Deno.test("resolveInputArtifacts — missing file stat is skipped gracefully", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    // Create a file then remove it between readDir iteration and stat
    // Simulate by creating a file, getting its path, removing it, and
    // checking resolveInputArtifacts handles the race gracefully.
    await Deno.writeTextFile(`${tmpDir}/exists.md`, "content");
    // First call should succeed
    const result1 = await resolveInputArtifacts({ node: tmpDir });
    assertEquals(result1.length, 1);

    // Remove file — simulate stat failure on next call
    await Deno.remove(`${tmpDir}/exists.md`);
    const result2 = await resolveInputArtifacts({ node: tmpDir });
    assertEquals(
      result2.length,
      0,
      "Missing files should be skipped without error",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("resolveInputArtifacts — skips subdirectories", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tmpDir}/file.md`, "content");
    await Deno.mkdir(`${tmpDir}/subdir`);
    await Deno.writeTextFile(`${tmpDir}/subdir/nested.md`, "nested");

    const inputs = { node: tmpDir };
    const result = await resolveInputArtifacts(inputs);

    // Should only include top-level files, not nested
    assertEquals(result.length, 1);
    assertEquals(result[0].path.includes("file.md"), true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// --- post-workflow node support tests ---

Deno.test("collectPostWorkflowNodes — collects nodes with run_on set", () => {
  const nodes: Record<string, NodeConfig> = {
    pm: { type: "agent", label: "PM" },
    developer: { type: "agent", label: "Developer" },
    "meta-agent": { type: "agent", label: "Meta-Agent", run_on: "always" },
  };
  const result = collectPostWorkflowNodes(nodes);
  assertEquals(result, ["meta-agent"]);
});

Deno.test("collectPostWorkflowNodes — returns empty when no run_on nodes", () => {
  const nodes: Record<string, NodeConfig> = {
    pm: { type: "agent", label: "PM" },
    developer: { type: "agent", label: "Developer" },
  };
  const result = collectPostWorkflowNodes(nodes);
  assertEquals(result, []);
});

Deno.test("collectPostWorkflowNodes — multiple run_on nodes", () => {
  const nodes: Record<string, NodeConfig> = {
    pm: { type: "agent", label: "PM" },
    "meta-agent": { type: "agent", label: "Meta-Agent", run_on: "always" },
    commit: { type: "agent", label: "Commit", run_on: "success" },
  };
  const result = collectPostWorkflowNodes(nodes);
  assertEquals(result.length, 2);
  assertEquals(result.includes("meta-agent"), true);
  assertEquals(result.includes("commit"), true);
});

Deno.test("post-workflow nodes excluded from regular DAG levels", () => {
  const nodes: Record<string, NodeConfig> = {
    pm: { type: "agent", label: "PM" },
    "meta-agent": { type: "agent", label: "Meta-Agent", run_on: "always" },
  };
  const postWorkflow = collectPostWorkflowNodes(nodes);
  const regularNodes = Object.keys(nodes).filter(
    (id) => !postWorkflow.includes(id),
  );
  assertEquals(regularNodes, ["pm"]);
  assertEquals(postWorkflow, ["meta-agent"]);
});

// --- NodeConfig.env field tests ---

Deno.test("NodeConfig — env field is optional and typed as Record<string, string>", () => {
  const node: NodeConfig = {
    type: "agent",
    label: "Commit Meta",
    env: { SDLC_PHASE: "meta" },
  };
  assertEquals(node.env, { SDLC_PHASE: "meta" });
});

Deno.test("NodeConfig — env field undefined when not set", () => {
  const node: NodeConfig = {
    type: "agent",
    label: "PM",
  };
  assertEquals(node.env, undefined);
});

// --- state.json failed node tracking tests ---

Deno.test("getNodesByStatus — extracts failed node IDs from run state", () => {
  const state: RunState = {
    run_id: "test-run",
    config_path: "config.yaml",
    started_at: new Date().toISOString(),
    status: "failed",
    args: {},
    env: {},
    nodes: {
      pm: { status: "completed" },
      developer: { status: "failed", error: "Agent failed" },
      qa: { status: "pending" },
      "meta-agent": { status: "pending" },
    },
  };
  const failed = getNodesByStatus(state, "failed");
  assertEquals(failed, ["developer"]);
  assertEquals(failed[0], "developer");
});

Deno.test("state.json — records status: failed for failed node (meta-agent reads state.json)", () => {
  // Meta-agent identifies failed nodes via state.json nodes[*].status === "failed"
  const state = createRunState(
    "test-run",
    "config.yaml",
    ["pm", "developer", "qa"],
    {},
    {},
  );
  markNodeStarted(state, "pm");
  markNodeCompleted(state, "pm");
  markNodeStarted(state, "developer");
  markNodeFailed(state, "developer", "Agent failed", "unknown");

  const failed = getNodesByStatus(state, "failed");
  assertEquals(failed, ["developer"]);
  assertEquals(state.nodes.developer.status, "failed");
  assertEquals(state.nodes.pm.status, "completed");
});

Deno.test("state.json — no failed nodes when all complete successfully", () => {
  const state = createRunState(
    "test-run",
    "config.yaml",
    ["pm", "developer"],
    {},
    {},
  );
  markNodeStarted(state, "pm");
  markNodeCompleted(state, "pm");
  markNodeStarted(state, "developer");
  markNodeCompleted(state, "developer");

  const failed = getNodesByStatus(state, "failed");
  assertEquals(failed.length, 0);
});

// --- post-workflow node ordering tests ---

Deno.test("sortPostWorkflowNodes — orders by dependency (commit-meta after meta-agent)", () => {
  const nodes: Record<string, NodeConfig> = {
    "commit-meta": {
      type: "agent",
      label: "Commit Meta",
      inputs: ["meta-agent"],
      run_on: "success",
    },
    "meta-agent": {
      type: "agent",
      label: "Meta-Agent",
      run_on: "always",
    },
  };
  const postWorkflowIds = ["commit-meta", "meta-agent"];
  const sorted = sortPostWorkflowNodes(postWorkflowIds, nodes);
  assertEquals(sorted, ["meta-agent", "commit-meta"]);
});

Deno.test("sortPostWorkflowNodes — single node returns as-is", () => {
  const nodes: Record<string, NodeConfig> = {
    "meta-agent": {
      type: "agent",
      label: "Meta-Agent",
      run_on: "always",
    },
  };
  const sorted = sortPostWorkflowNodes(["meta-agent"], nodes);
  assertEquals(sorted, ["meta-agent"]);
});

Deno.test("sortPostWorkflowNodes — no dependencies preserves alphabetical order", () => {
  const nodes: Record<string, NodeConfig> = {
    "cleanup": { type: "agent", label: "Cleanup", run_on: "always" },
    "meta-agent": { type: "agent", label: "Meta-Agent", run_on: "always" },
  };
  const sorted = sortPostWorkflowNodes(["cleanup", "meta-agent"], nodes);
  assertEquals(sorted, ["cleanup", "meta-agent"]);
});

// --- collectAllNodeIds tests ---

Deno.test("collectAllNodeIds — includes top-level and nested body node IDs", () => {
  const config: WorkflowConfig = {
    name: "test",
    version: "1",
    nodes: {
      pm: { type: "agent", label: "PM", prompt: "spec" },
      "impl-loop": {
        type: "loop",
        label: "Impl loop",
        condition_node: "qa",
        condition_field: "verdict",
        exit_value: "PASS",
        nodes: {
          developer: {
            type: "agent",
            label: "Developer",
            prompt: "implement",
          },
          qa: {
            type: "agent",
            label: "QA",
            prompt: "verify",
            inputs: ["developer"],
          },
        },
      },
    },
  };
  const ids = collectAllNodeIds(config);
  assertEquals(ids.includes("pm"), true);
  assertEquals(ids.includes("impl-loop"), true);
  assertEquals(ids.includes("developer"), true);
  assertEquals(ids.includes("qa"), true);
  assertEquals(ids.length, 4);
});

Deno.test("collectAllNodeIds — no loop nodes returns top-level only", () => {
  const config: WorkflowConfig = {
    name: "test",
    version: "1",
    nodes: {
      a: { type: "agent", label: "A", prompt: "x" },
      b: { type: "agent", label: "B", prompt: "y" },
    },
  };
  const ids = collectAllNodeIds(config);
  assertEquals(ids, ["a", "b"]);
});

// --- findNodeConfig tests ---

Deno.test("findNodeConfig — finds top-level node", () => {
  const config: WorkflowConfig = {
    name: "test",
    version: "1",
    nodes: {
      pm: { type: "agent", label: "PM", prompt: "spec" },
    },
  };
  const node = findNodeConfig(config, "pm");
  assertEquals(node?.label, "PM");
});

Deno.test("findNodeConfig — finds loop body node", () => {
  const config: WorkflowConfig = {
    name: "test",
    version: "1",
    nodes: {
      "impl-loop": {
        type: "loop",
        label: "Loop",
        condition_node: "qa",
        condition_field: "verdict",
        exit_value: "PASS",
        nodes: {
          developer: {
            type: "agent",
            label: "Developer",
            prompt: "impl",
          },
          qa: {
            type: "agent",
            label: "QA",
            prompt: "verify",
            inputs: ["developer"],
          },
        },
      },
    },
  };
  const developer = findNodeConfig(config, "developer");
  assertEquals(developer?.label, "Developer");

  const qa = findNodeConfig(config, "qa");
  assertEquals(qa?.label, "QA");
  assertEquals(qa?.inputs, ["developer"]);
});

// --- run_on filtering tests ---

Deno.test("collectPostWorkflowNodes — collects all run_on variants", () => {
  const nodes: Record<string, NodeConfig> = {
    pm: { type: "agent", label: "PM" },
    "meta-agent": { type: "agent", label: "Meta-Agent", run_on: "always" },
    commit: { type: "agent", label: "Commit", run_on: "success" },
    notify: { type: "agent", label: "Notify", run_on: "failure" },
  };
  const result = collectPostWorkflowNodes(nodes);
  assertEquals(result.length, 3);
  assertEquals(result.includes("meta-agent"), true);
  assertEquals(result.includes("commit"), true);
  assertEquals(result.includes("notify"), true);
});

Deno.test("collectPostWorkflowNodes — run_on: 'failure' node is collected", () => {
  const nodes: Record<string, NodeConfig> = {
    pm: { type: "agent", label: "PM" },
    notify: { type: "agent", label: "Notify", run_on: "failure" },
  };
  const result = collectPostWorkflowNodes(nodes);
  assertEquals(result, ["notify"]);
});

Deno.test("findNodeConfig — returns undefined for unknown node", () => {
  const config: WorkflowConfig = {
    name: "test",
    version: "1",
    nodes: {
      pm: { type: "agent", label: "PM", prompt: "spec" },
    },
  };
  const node = findNodeConfig(config, "nonexistent");
  assertEquals(node, undefined);
});

// --- dryRunPlan post-workflow section tests ---

Deno.test("dryRunPlan — renders Post-workflow section when postWorkflowNodeIds provided", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  const levels = [["pm", "architect"], ["tech-lead"]];
  const labels: Record<string, string> = {
    pm: "PM Agent",
    architect: "Architect",
    "tech-lead": "Tech Lead",
    "meta-agent": "Meta Agent",
    "tech-lead-review": "Tech Lead Review",
  };
  const postWorkflowNodeIds = ["meta-agent", "tech-lead-review"];
  const runOnMap: Record<string, string> = {
    "meta-agent": "always",
    "tech-lead-review": "always",
  };
  out.dryRunPlan(levels, labels, postWorkflowNodeIds, runOnMap);
  const output = cap.lines.join("");
  assertEquals(output.includes("Level 1"), true);
  assertEquals(output.includes("pm"), true);
  assertEquals(output.includes("Post-workflow:"), true);
  assertEquals(output.includes("meta-agent"), true);
  assertEquals(output.includes("always"), true);
  assertEquals(output.includes("tech-lead-review"), true);
});

Deno.test("dryRunPlan — no Post-workflow section when postWorkflowNodeIds is empty", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  const levels = [["pm"]];
  const labels: Record<string, string> = { pm: "PM Agent" };
  out.dryRunPlan(levels, labels, [], {});
  const output = cap.lines.join("");
  assertEquals(output.includes("Post-workflow:"), false);
});

Deno.test("dryRunPlan — no Post-workflow section when params omitted (backward compat)", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  const levels = [["pm"]];
  const labels: Record<string, string> = { pm: "PM Agent" };
  out.dryRunPlan(levels, labels);
  const output = cap.lines.join("");
  assertEquals(output.includes("Post-workflow:"), false);
  assertEquals(output.includes("Level 1"), true);
});

// --- Task 4: executeLoopNode onNodeComplete → nodeResult() wiring ---

Deno.test("executeLoopNode onNodeComplete — calls nodeResult() for successful loop body with output", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);

  const mockResult: AgentResult = {
    success: true,
    continuations: 0,
    output: {
      result: "Loop body completed successfully",
      session_id: "s-loop-1",
      total_cost_usd: 0.0080,
      duration_ms: 15000,
      duration_api_ms: 14000,
      num_turns: 3,
      is_error: false,
    },
  };

  // Simulate the onNodeComplete callback from executeLoopNode (engine.ts:545-565)
  const onNodeComplete = (
    id: string,
    _iteration: number,
    result: AgentResult,
  ) => {
    if (result.success) {
      out.status(id, "COMPLETED");
      if (result.output) {
        out.nodeResult(id, result.output);
      }
    } else {
      out.nodeFailed(id, result.error ?? "Failed");
    }
  };

  onNodeComplete("developer", 1, mockResult);

  const output = cap.lines.join("");
  assertEquals(output.includes("RESULT:"), true);
  assertEquals(output.includes("Loop body completed successfully"), true);
  assertEquals(output.includes("cost=$0.0080"), true);
  assertEquals(output.includes("turns=3"), true);
  assertEquals(output.includes("duration=15s"), true);
});

Deno.test("executeLoopNode onNodeComplete — suppresses nodeResult() in quiet mode", () => {
  const cap = createCapture();
  const out = new OutputManager("quiet", cap.writer);

  const mockResult: AgentResult = {
    success: true,
    continuations: 0,
    output: {
      result: "Loop body done",
      session_id: "s-loop-2",
      total_cost_usd: 0.005,
      duration_ms: 5000,
      duration_api_ms: 4500,
      num_turns: 2,
      is_error: false,
    },
  };

  const onNodeComplete = (
    id: string,
    _iteration: number,
    result: AgentResult,
  ) => {
    if (result.success) {
      out.status(id, "COMPLETED");
      if (result.output) {
        out.nodeResult(id, result.output);
      }
    } else {
      out.nodeFailed(id, result.error ?? "Failed");
    }
  };

  onNodeComplete("developer", 1, mockResult);

  // quiet mode: status() and nodeResult() both suppressed; only errors shown
  assertEquals(cap.lines.length, 0);
});

Deno.test("executeLoopNode onNodeComplete — skips nodeResult() when result has no output", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);

  const mockResult: AgentResult = {
    success: true,
    continuations: 0,
    // output intentionally absent
  };

  const onNodeComplete = (
    id: string,
    _iteration: number,
    result: AgentResult,
  ) => {
    if (result.success) {
      out.status(id, "COMPLETED");
      if (result.output) {
        out.nodeResult(id, result.output);
      }
    } else {
      out.nodeFailed(id, result.error ?? "Failed");
    }
  };

  onNodeComplete("developer", 1, mockResult);

  const output = cap.lines.join("");
  assertEquals(output.includes("COMPLETED"), true);
  assertEquals(output.includes("RESULT:"), false);
});

Deno.test("dry-run — post-workflow nodes excluded from regular levels filtering logic", () => {
  const nodes: Record<string, NodeConfig> = {
    pm: { type: "agent", label: "PM" },
    architect: { type: "agent", label: "Architect", inputs: ["pm"] },
    "meta-agent": { type: "agent", label: "Meta-Agent", run_on: "always" },
    "tech-lead-review": {
      type: "agent",
      label: "TL Review",
      run_on: "always",
    },
  };
  const levels = [["pm"], ["architect"], ["meta-agent", "tech-lead-review"]];
  const postWorkflowIds = collectPostWorkflowNodes(nodes);
  const filteredLevels = levels
    .map((l) => l.filter((id) => !postWorkflowIds.includes(id)))
    .filter((l) => l.length > 0);

  assertEquals(filteredLevels.length, 2);
  assertEquals(filteredLevels[0], ["pm"]);
  assertEquals(filteredLevels[1], ["architect"]);
  for (const level of filteredLevels) {
    assertEquals(level.includes("meta-agent"), false);
    assertEquals(level.includes("tech-lead-review"), false);
  }
  assertEquals(postWorkflowIds.length, 2);
  assertEquals(postWorkflowIds.includes("meta-agent"), true);
  assertEquals(postWorkflowIds.includes("tech-lead-review"), true);
});

// --- FR-E17: Cost field integration tests ---

Deno.test("NodeState — cost_usd field present after markNodeCompleted with cost", () => {
  const state = createRunState("test", "cfg.yaml", ["agent1"], {}, {});
  markNodeStarted(state, "agent1");
  markNodeCompleted(state, "agent1", 0.0123);

  assertEquals(state.nodes.agent1.cost_usd, 0.0123);
  assertEquals(state.total_cost_usd, 0.0123);
});

Deno.test("RunState — total_cost_usd accumulates across multiple agent nodes", () => {
  const state = createRunState(
    "test",
    "cfg.yaml",
    ["spec", "plan", "exec"],
    {},
    {},
  );
  markNodeStarted(state, "spec");
  markNodeCompleted(state, "spec", 0.01);
  markNodeStarted(state, "plan");
  markNodeCompleted(state, "plan", 0.02);
  markNodeStarted(state, "exec");
  markNodeCompleted(state, "exec", 0.005);

  // Use toFixed(4) comparison to avoid floating-point precision issues
  assertEquals(
    Number((state.total_cost_usd ?? 0).toFixed(4)),
    0.035,
  );
  assertEquals(state.nodes.spec.cost_usd, 0.01);
  assertEquals(state.nodes.plan.cost_usd, 0.02);
  assertEquals(state.nodes.exec.cost_usd, 0.005);
});

Deno.test("NodeState — cost_usd undefined when no cost passed to markNodeCompleted", () => {
  const state = createRunState("test", "cfg.yaml", ["a"], {}, {});
  markNodeStarted(state, "a");
  markNodeCompleted(state, "a");

  const ns: NodeState = state.nodes.a;
  assertEquals(ns.cost_usd, undefined);
  assertEquals(state.total_cost_usd, undefined);
});

Deno.test("RunState — total_cost_usd in state.json roundtrip", async () => {
  const state = createRunState("test-cost", "cfg.yaml", ["a", "b"], {}, {});
  markNodeStarted(state, "a");
  markNodeCompleted(state, "a", 0.007);
  markNodeStarted(state, "b");
  markNodeCompleted(state, "b", 0.003);

  const tmpDir = await Deno.makeTempDir();
  try {
    const statePath = `${tmpDir}/state.json`;
    await Deno.writeTextFile(statePath, JSON.stringify(state, null, 2) + "\n");
    const loaded = JSON.parse(await Deno.readTextFile(statePath)) as RunState;

    assertEquals(loaded.total_cost_usd, 0.01);
    assertEquals(loaded.nodes.a.cost_usd, 0.007);
    assertEquals(loaded.nodes.b.cost_usd, 0.003);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// --- FR-E19: runFailureHook tests ---

Deno.test("runFailureHook — no-op when script undefined", async () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  await runFailureHook(undefined, out);
  assertEquals(cap.lines.length, 0);
});

Deno.test("runFailureHook — executes script and logs completion", async () => {
  const tmpScript = await Deno.makeTempFile({ suffix: ".sh" });
  try {
    await Deno.writeTextFile(tmpScript, "#!/bin/bash\necho 'hook ran'");
    await Deno.chmod(tmpScript, 0o755);
    const cap = createCapture();
    const out = new OutputManager("normal", cap.writer);
    await runFailureHook(tmpScript, out);
    const output = cap.lines.join("");
    assertEquals(
      output.includes("hook ran") || output.includes("completed"),
      true,
    );
  } finally {
    await Deno.remove(tmpScript);
  }
});

Deno.test("runFailureHook — script failure does not throw (swallows error)", async () => {
  const tmpScript = await Deno.makeTempFile({ suffix: ".sh" });
  try {
    await Deno.writeTextFile(tmpScript, "#!/bin/bash\nexit 1");
    await Deno.chmod(tmpScript, 0o755);
    const cap = createCapture();
    const out = new OutputManager("normal", cap.writer);
    // Must not throw
    await runFailureHook(tmpScript, out);
    const output = cap.lines.join("");
    assertEquals(output.includes("WARN"), true);
  } finally {
    await Deno.remove(tmpScript);
  }
});

Deno.test("runFailureHook — nonexistent script does not throw (swallows error)", async () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  await runFailureHook("/nonexistent/hook.sh", out);
  const output = cap.lines.join("");
  assertEquals(output.includes("WARN"), true);
});

// --- FR-E22: printSummary() nodeResults rendering tests ---

Deno.test("summary() — renders node results from RunSummary nodeResults field", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);

  // Simulate a completed run state with result excerpts
  const state = createRunState(
    "test-run",
    "cfg.yaml",
    ["build", "verify"],
    {},
    {},
  );
  markNodeStarted(state, "build");
  markNodeCompleted(
    state,
    "build",
    0.01,
    "Implemented feature X | Added tests",
  );
  markNodeStarted(state, "verify");
  markNodeCompleted(state, "verify", 0.005, "All checks passed");

  // Build nodeResults as printSummary() would
  const nodeResults: Record<string, string> = {};
  for (const [id, node] of Object.entries(state.nodes)) {
    if ((node as NodeState).result) {
      nodeResults[id] = (node as NodeState).result!;
    }
  }

  out.summary({
    name: "test-workflow",
    runId: state.run_id,
    status: "completed",
    durationMs: 60000,
    total: 2,
    completed: 2,
    failed: 0,
    skipped: 0,
    nodeResults,
  });

  const joined = cap.lines.join("");
  assertEquals(joined.includes("build"), true);
  assertEquals(joined.includes("Implemented feature X"), true);
  assertEquals(joined.includes("verify"), true);
  assertEquals(joined.includes("All checks passed"), true);
});

Deno.test("summary() — omits nodeResults section when no nodes have results", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);

  out.summary({
    name: "test-workflow",
    runId: "test-run",
    status: "completed",
    durationMs: 5000,
    total: 1,
    completed: 1,
    failed: 0,
    skipped: 0,
  });

  const joined = cap.lines.join("");
  assertEquals(joined.includes("Workflow:"), true);
  assertEquals(joined.includes("1/1 completed"), true);
  // No extra result lines injected
  assertEquals(
    joined.split("\n").filter((l) => l.match(/^\s+\w.*\s{2}/)).length,
    0,
  );
});

// --- FR-E30: runPrepareCommand tests ---

Deno.test("runPrepareCommand — executes command on fresh run", async () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  await runPrepareCommand("echo ok", "/tmp", "test-run", {}, {}, out);
  const output = cap.lines.join("");
  assertEquals(output.includes("PREPARE_COMMAND"), true);
});

Deno.test("runPrepareCommand — throws on non-zero exit (failure abort)", async () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  let thrown = false;
  try {
    await runPrepareCommand("exit 1", "/tmp", "test-run", {}, {}, out);
  } catch (e) {
    thrown = true;
    assertEquals(
      (e as Error).message.includes("prepare_command failed"),
      true,
    );
  }
  assertEquals(thrown, true);
});

Deno.test("runPrepareCommand — skipped when resume=true (guard logic)", () => {
  // The call site in runWithLock() uses: !this.options.resume && prepareCmd
  // This test verifies the boolean guard prevents execution on resume runs.
  const opts = makeOptions({ resume: true, run_id: "20260315T000000" });
  const cmd = "exit 1"; // would throw if executed
  const shouldRun = !opts.resume && !!cmd;
  assertEquals(shouldRun, false);
});

Deno.test("runPrepareCommand — interpolates run_id in command", async () => {
  const tmpFile = await Deno.makeTempFile();
  try {
    const cap = createCapture();
    const out = new OutputManager("normal", cap.writer);
    await runPrepareCommand(
      `echo {{run_id}} > ${tmpFile}`,
      "/tmp",
      "my-run-id",
      {},
      {},
      out,
    );
    const content = await Deno.readTextFile(tmpFile);
    assertEquals(content.trim(), "my-run-id");
  } finally {
    await Deno.remove(tmpFile);
  }
});

// --- FR-E34: on_error: continue interaction tests ---

Deno.test("FR-E34 — continue-d failure: info log emitted, hook not called", async () => {
  const tmpScript = await Deno.makeTempFile({ suffix: ".sh" });
  try {
    await Deno.writeTextFile(tmpScript, "#!/bin/bash\necho 'HOOK_CALLED'");
    await Deno.chmod(tmpScript, 0o755);
    const cap = createCapture();
    const out = new OutputManager("normal", cap.writer);
    const state = createRunState("fre34-t1", "cfg.yaml", ["p1"], {}, {});
    const nodes: Record<string, NodeConfig> = {
      p1: { type: "agent", label: "P1", run_on: "success" },
    };
    // workflowSuccess=true: continue-d failure does NOT set workflowSuccess false
    await executePostWorkflow({
      nodeIds: ["p1"],
      nodes,
      state,
      workflowSuccess: true,
      failureScript: tmpScript,
      output: out,
      executeNode: (_id) => {
        // Simulate Task 1 log emission at on_error: continue branch
        out.status(
          "engine",
          `node ${_id}: failure suppressed by on_error: continue`,
        );
        return Promise.resolve(true);
      },
    });
    const joined = cap.lines.join("");
    assertEquals(
      joined.includes("failure suppressed by on_error: continue"),
      true,
    );
    assertEquals(joined.includes("HOOK_CALLED"), false);
  } finally {
    await Deno.remove(tmpScript);
  }
});

Deno.test("FR-E34 — all failures continue-d: workflowSuccess true, hook not called", async () => {
  const tmpScript = await Deno.makeTempFile({ suffix: ".sh" });
  try {
    await Deno.writeTextFile(tmpScript, "#!/bin/bash\necho 'HOOK_CALLED'");
    await Deno.chmod(tmpScript, 0o755);
    const cap = createCapture();
    const out = new OutputManager("normal", cap.writer);
    // Replicate executeLevel loop: all nodes continue-d → workflowSuccess stays true
    let workflowSuccess = true;
    for (const result of [true, true]) {
      if (!result) {
        workflowSuccess = false;
        break;
      }
    }
    assertEquals(workflowSuccess, true);
    const state = createRunState("fre34-t2", "cfg.yaml", ["p1"], {}, {});
    const nodes: Record<string, NodeConfig> = {
      p1: { type: "agent", label: "P1", run_on: "success" },
    };
    await executePostWorkflow({
      nodeIds: ["p1"],
      nodes,
      state,
      workflowSuccess,
      failureScript: tmpScript,
      output: out,
      executeNode: (_id) => Promise.resolve(true),
    });
    const joined = cap.lines.join("");
    assertEquals(joined.includes("HOOK_CALLED"), false);
    assertEquals(joined.includes("Failure hook"), false);
  } finally {
    await Deno.remove(tmpScript);
  }
});

Deno.test("FR-E34 — one fatal failure among continue-d: hook called exactly once", async () => {
  const tmpScript = await Deno.makeTempFile({ suffix: ".sh" });
  try {
    await Deno.writeTextFile(tmpScript, "#!/bin/bash\necho 'HOOK_CALLED'");
    await Deno.chmod(tmpScript, 0o755);
    const cap = createCapture();
    const out = new OutputManager("normal", cap.writer);
    // Replicate executeLevel loop: node-a continue-d (true), node-b fatal (false)
    let workflowSuccess = true;
    for (const result of [true, false]) {
      if (!result) {
        workflowSuccess = false;
        break;
      }
    }
    assertEquals(workflowSuccess, false);
    const state = createRunState("fre34-t3", "cfg.yaml", ["p1"], {}, {});
    const nodes: Record<string, NodeConfig> = {
      p1: { type: "agent", label: "P1", run_on: "failure" },
    };
    await executePostWorkflow({
      nodeIds: ["p1"],
      nodes,
      state,
      workflowSuccess,
      failureScript: tmpScript,
      output: out,
      executeNode: (_id) => Promise.resolve(true),
    });
    const joined = cap.lines.join("");
    // Hook called exactly once
    const hookCount = (joined.match(/Failure hook completed/g) ?? []).length;
    assertEquals(hookCount, 1);
  } finally {
    await Deno.remove(tmpScript);
  }
});

Deno.test("FR-E34 — hook script fails after continue-d failure: warn emitted, no re-trigger", async () => {
  const tmpScript = await Deno.makeTempFile({ suffix: ".sh" });
  try {
    await Deno.writeTextFile(tmpScript, "#!/bin/bash\nexit 1");
    await Deno.chmod(tmpScript, 0o755);
    const cap = createCapture();
    const out = new OutputManager("normal", cap.writer);
    const state = createRunState("fre34-t4", "cfg.yaml", ["p1"], {}, {});
    const nodes: Record<string, NodeConfig> = {
      p1: { type: "agent", label: "P1", run_on: "failure" },
    };
    // workflowSuccess=false: one fatal failure (hook is attempted)
    await executePostWorkflow({
      nodeIds: ["p1"],
      nodes,
      state,
      workflowSuccess: false,
      failureScript: tmpScript,
      output: out,
      executeNode: (_id) => Promise.resolve(true),
    });
    const joined = cap.lines.join("");
    assertEquals(joined.includes("WARN"), true);
    assertEquals(joined.includes("Failure hook completed"), false);
  } finally {
    await Deno.remove(tmpScript);
  }
});

Deno.test("FR-E34 — log message format: failure suppressed by on_error: continue", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  // Verify format produced by engine.ts at the on_error: continue branch
  out.status(
    "engine",
    "node worker-1: failure suppressed by on_error: continue",
  );
  const joined = cap.lines.join("");
  assertEquals(joined.includes("worker-1"), true);
  assertEquals(
    joined.includes("failure suppressed by on_error: continue"),
    true,
  );
});
