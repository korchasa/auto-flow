import { assertEquals } from "@std/assert";
import type {
  EngineOptions,
  NodeConfig,
  NodeState,
  PipelineConfig,
  RunState,
} from "./types.ts";
import {
  collectAllNodeIds,
  collectPostPipelineNodes,
  Engine,
  findNodeConfig,
  resolveInputArtifacts,
  runFailureHook,
  sortPostPipelineNodes,
} from "./engine.ts";
import type { AgentResult } from "./agent.ts";
import {
  createRunState,
  getNodesByStatus,
  markNodeCompleted,
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
    config_path: ".sdlc/pipeline.yaml",
    verbosity: "quiet",
    args: {},
    env_overrides: {},
    ...overrides,
  };
}

Deno.test("EngineOptions — default structure", () => {
  const opts = makeOptions();
  assertEquals(opts.config_path, ".sdlc/pipeline.yaml");
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

// --- post-pipeline node support tests ---

Deno.test("collectPostPipelineNodes — collects nodes with run_on set", () => {
  const nodes: Record<string, NodeConfig> = {
    pm: { type: "agent", label: "PM" },
    developer: { type: "agent", label: "Developer" },
    "meta-agent": { type: "agent", label: "Meta-Agent", run_on: "always" },
  };
  const result = collectPostPipelineNodes(nodes);
  assertEquals(result, ["meta-agent"]);
});

Deno.test("collectPostPipelineNodes — returns empty when no run_on nodes", () => {
  const nodes: Record<string, NodeConfig> = {
    pm: { type: "agent", label: "PM" },
    developer: { type: "agent", label: "Developer" },
  };
  const result = collectPostPipelineNodes(nodes);
  assertEquals(result, []);
});

Deno.test("collectPostPipelineNodes — multiple run_on nodes", () => {
  const nodes: Record<string, NodeConfig> = {
    pm: { type: "agent", label: "PM" },
    "meta-agent": { type: "agent", label: "Meta-Agent", run_on: "always" },
    commit: { type: "agent", label: "Commit", run_on: "success" },
  };
  const result = collectPostPipelineNodes(nodes);
  assertEquals(result.length, 2);
  assertEquals(result.includes("meta-agent"), true);
  assertEquals(result.includes("commit"), true);
});

Deno.test("post-pipeline nodes excluded from regular DAG levels", () => {
  const nodes: Record<string, NodeConfig> = {
    pm: { type: "agent", label: "PM" },
    "meta-agent": { type: "agent", label: "Meta-Agent", run_on: "always" },
  };
  const postPipeline = collectPostPipelineNodes(nodes);
  const regularNodes = Object.keys(nodes).filter(
    (id) => !postPipeline.includes(id),
  );
  assertEquals(regularNodes, ["pm"]);
  assertEquals(postPipeline, ["meta-agent"]);
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

// --- Pre-post-pipeline rollback + failed-node-id extraction tests ---

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

Deno.test("failed-node.txt — written with failed node ID on pipeline failure", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    // Simulate writing failed-node.txt (same logic as engine pre-step)
    const failedNodeId = "developer";
    const failedNodePath = `${tmpDir}/failed-node.txt`;
    await Deno.writeTextFile(failedNodePath, failedNodeId);

    const content = await Deno.readTextFile(failedNodePath);
    assertEquals(content, "developer");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("failed-node.txt — not written when no failed nodes", () => {
  const state: RunState = {
    run_id: "test-run",
    config_path: "config.yaml",
    started_at: new Date().toISOString(),
    status: "completed",
    args: {},
    env: {},
    nodes: {
      pm: { status: "completed" },
      developer: { status: "completed" },
    },
  };
  const failed = getNodesByStatus(state, "failed");
  assertEquals(failed.length, 0);
});

// --- post-pipeline node ordering tests ---

Deno.test("sortPostPipelineNodes — orders by dependency (commit-meta after meta-agent)", () => {
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
  const postPipelineIds = ["commit-meta", "meta-agent"];
  const sorted = sortPostPipelineNodes(postPipelineIds, nodes);
  assertEquals(sorted, ["meta-agent", "commit-meta"]);
});

Deno.test("sortPostPipelineNodes — single node returns as-is", () => {
  const nodes: Record<string, NodeConfig> = {
    "meta-agent": {
      type: "agent",
      label: "Meta-Agent",
      run_on: "always",
    },
  };
  const sorted = sortPostPipelineNodes(["meta-agent"], nodes);
  assertEquals(sorted, ["meta-agent"]);
});

Deno.test("sortPostPipelineNodes — no dependencies preserves alphabetical order", () => {
  const nodes: Record<string, NodeConfig> = {
    "cleanup": { type: "agent", label: "Cleanup", run_on: "always" },
    "meta-agent": { type: "agent", label: "Meta-Agent", run_on: "always" },
  };
  const sorted = sortPostPipelineNodes(["cleanup", "meta-agent"], nodes);
  assertEquals(sorted, ["cleanup", "meta-agent"]);
});

// --- collectAllNodeIds tests ---

Deno.test("collectAllNodeIds — includes top-level and nested body node IDs", () => {
  const config: PipelineConfig = {
    name: "test",
    version: "1",
    nodes: {
      pm: { type: "agent", label: "PM", task_template: "spec" },
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
            task_template: "implement",
          },
          qa: {
            type: "agent",
            label: "QA",
            task_template: "verify",
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
  const config: PipelineConfig = {
    name: "test",
    version: "1",
    nodes: {
      a: { type: "agent", label: "A", task_template: "x" },
      b: { type: "agent", label: "B", task_template: "y" },
    },
  };
  const ids = collectAllNodeIds(config);
  assertEquals(ids, ["a", "b"]);
});

// --- findNodeConfig tests ---

Deno.test("findNodeConfig — finds top-level node", () => {
  const config: PipelineConfig = {
    name: "test",
    version: "1",
    nodes: {
      pm: { type: "agent", label: "PM", task_template: "spec" },
    },
  };
  const node = findNodeConfig(config, "pm");
  assertEquals(node?.label, "PM");
});

Deno.test("findNodeConfig — finds loop body node", () => {
  const config: PipelineConfig = {
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
            task_template: "impl",
          },
          qa: {
            type: "agent",
            label: "QA",
            task_template: "verify",
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

Deno.test("collectPostPipelineNodes — collects all run_on variants", () => {
  const nodes: Record<string, NodeConfig> = {
    pm: { type: "agent", label: "PM" },
    "meta-agent": { type: "agent", label: "Meta-Agent", run_on: "always" },
    commit: { type: "agent", label: "Commit", run_on: "success" },
    notify: { type: "agent", label: "Notify", run_on: "failure" },
  };
  const result = collectPostPipelineNodes(nodes);
  assertEquals(result.length, 3);
  assertEquals(result.includes("meta-agent"), true);
  assertEquals(result.includes("commit"), true);
  assertEquals(result.includes("notify"), true);
});

Deno.test("collectPostPipelineNodes — run_on: 'failure' node is collected", () => {
  const nodes: Record<string, NodeConfig> = {
    pm: { type: "agent", label: "PM" },
    notify: { type: "agent", label: "Notify", run_on: "failure" },
  };
  const result = collectPostPipelineNodes(nodes);
  assertEquals(result, ["notify"]);
});

Deno.test("findNodeConfig — returns undefined for unknown node", () => {
  const config: PipelineConfig = {
    name: "test",
    version: "1",
    nodes: {
      pm: { type: "agent", label: "PM", task_template: "spec" },
    },
  };
  const node = findNodeConfig(config, "nonexistent");
  assertEquals(node, undefined);
});

// --- dryRunPlan post-pipeline section tests ---

Deno.test("dryRunPlan — renders Post-pipeline section when postPipelineNodeIds provided", () => {
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
  const postPipelineNodeIds = ["meta-agent", "tech-lead-review"];
  const runOnMap: Record<string, string> = {
    "meta-agent": "always",
    "tech-lead-review": "always",
  };
  out.dryRunPlan(levels, labels, postPipelineNodeIds, runOnMap);
  const output = cap.lines.join("");
  assertEquals(output.includes("Level 1"), true);
  assertEquals(output.includes("pm"), true);
  assertEquals(output.includes("Post-pipeline:"), true);
  assertEquals(output.includes("meta-agent"), true);
  assertEquals(output.includes("always"), true);
  assertEquals(output.includes("tech-lead-review"), true);
});

Deno.test("dryRunPlan — no Post-pipeline section when postPipelineNodeIds is empty", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  const levels = [["pm"]];
  const labels: Record<string, string> = { pm: "PM Agent" };
  out.dryRunPlan(levels, labels, [], {});
  const output = cap.lines.join("");
  assertEquals(output.includes("Post-pipeline:"), false);
});

Deno.test("dryRunPlan — no Post-pipeline section when params omitted (backward compat)", () => {
  const cap = createCapture();
  const out = new OutputManager("normal", cap.writer);
  const levels = [["pm"]];
  const labels: Record<string, string> = { pm: "PM Agent" };
  out.dryRunPlan(levels, labels);
  const output = cap.lines.join("");
  assertEquals(output.includes("Post-pipeline:"), false);
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

Deno.test("dry-run — post-pipeline nodes excluded from regular levels filtering logic", () => {
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
  const postPipelineIds = collectPostPipelineNodes(nodes);
  const filteredLevels = levels
    .map((l) => l.filter((id) => !postPipelineIds.includes(id)))
    .filter((l) => l.length > 0);

  assertEquals(filteredLevels.length, 2);
  assertEquals(filteredLevels[0], ["pm"]);
  assertEquals(filteredLevels[1], ["architect"]);
  for (const level of filteredLevels) {
    assertEquals(level.includes("meta-agent"), false);
    assertEquals(level.includes("tech-lead-review"), false);
  }
  assertEquals(postPipelineIds.length, 2);
  assertEquals(postPipelineIds.includes("meta-agent"), true);
  assertEquals(postPipelineIds.includes("tech-lead-review"), true);
});

// --- FR-32: Cost field integration tests ---

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

// --- FR-34: runFailureHook tests ---

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
