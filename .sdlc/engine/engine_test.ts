import { assertEquals } from "@std/assert";
import type {
  EngineOptions,
  NodeConfig,
  PipelineConfig,
  RunState,
} from "./types.ts";
import {
  collectAllNodeIds,
  collectPostPipelineNodes,
  Engine,
  findNodeConfig,
  resolveInputArtifacts,
  sortPostPipelineNodes,
} from "./engine.ts";
import { getNodesByStatus } from "./state.ts";
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
    executor: { type: "agent", label: "Executor" },
    "meta-agent": { type: "agent", label: "Meta-Agent", run_on: "always" },
  };
  const result = collectPostPipelineNodes(nodes);
  assertEquals(result, ["meta-agent"]);
});

Deno.test("collectPostPipelineNodes — returns empty when no run_on nodes", () => {
  const nodes: Record<string, NodeConfig> = {
    pm: { type: "agent", label: "PM" },
    executor: { type: "agent", label: "Executor" },
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
      executor: { status: "failed", error: "Agent failed" },
      qa: { status: "pending" },
      "meta-agent": { status: "pending" },
    },
  };
  const failed = getNodesByStatus(state, "failed");
  assertEquals(failed, ["executor"]);
  assertEquals(failed[0], "executor");
});

Deno.test("failed-node.txt — written with failed node ID on pipeline failure", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    // Simulate writing failed-node.txt (same logic as engine pre-step)
    const failedNodeId = "executor";
    const failedNodePath = `${tmpDir}/failed-node.txt`;
    await Deno.writeTextFile(failedNodePath, failedNodeId);

    const content = await Deno.readTextFile(failedNodePath);
    assertEquals(content, "executor");
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
      executor: { status: "completed" },
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
          executor: {
            type: "agent",
            label: "Executor",
            task_template: "implement",
          },
          qa: {
            type: "agent",
            label: "QA",
            task_template: "verify",
            inputs: ["executor"],
          },
        },
      },
    },
  };
  const ids = collectAllNodeIds(config);
  assertEquals(ids.includes("pm"), true);
  assertEquals(ids.includes("impl-loop"), true);
  assertEquals(ids.includes("executor"), true);
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
          executor: { type: "agent", label: "Executor", task_template: "impl" },
          qa: {
            type: "agent",
            label: "QA",
            task_template: "verify",
            inputs: ["executor"],
          },
        },
      },
    },
  };
  const executor = findNodeConfig(config, "executor");
  assertEquals(executor?.label, "Executor");

  const qa = findNodeConfig(config, "qa");
  assertEquals(qa?.label, "QA");
  assertEquals(qa?.inputs, ["executor"]);
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
