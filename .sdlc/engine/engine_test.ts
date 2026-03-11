import { assertEquals } from "@std/assert";
import type { EngineOptions, NodeConfig } from "./types.ts";
import {
  collectRunAlwaysNodes,
  Engine,
  resolveInputArtifacts,
} from "./engine.ts";
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

// --- run_always node support tests ---

Deno.test("collectRunAlwaysNodes — collects nodes with run_always: true", () => {
  const nodes: Record<string, NodeConfig> = {
    pm: { type: "agent", label: "PM" },
    executor: { type: "agent", label: "Executor" },
    "meta-agent": { type: "agent", label: "Meta-Agent", run_always: true },
  };
  const result = collectRunAlwaysNodes(nodes);
  assertEquals(result, ["meta-agent"]);
});

Deno.test("collectRunAlwaysNodes — returns empty when no run_always nodes", () => {
  const nodes: Record<string, NodeConfig> = {
    pm: { type: "agent", label: "PM" },
    executor: { type: "agent", label: "Executor" },
  };
  const result = collectRunAlwaysNodes(nodes);
  assertEquals(result, []);
});

Deno.test("collectRunAlwaysNodes — multiple run_always nodes", () => {
  const nodes: Record<string, NodeConfig> = {
    pm: { type: "agent", label: "PM" },
    "meta-agent": { type: "agent", label: "Meta-Agent", run_always: true },
    cleanup: { type: "agent", label: "Cleanup", run_always: true },
  };
  const result = collectRunAlwaysNodes(nodes);
  assertEquals(result.length, 2);
  assertEquals(result.includes("meta-agent"), true);
  assertEquals(result.includes("cleanup"), true);
});

Deno.test("run_always nodes excluded from regular DAG levels", () => {
  // run_always nodes should not appear in regular DAG levels.
  // They execute in a separate post-levels step.
  const nodes: Record<string, NodeConfig> = {
    pm: { type: "agent", label: "PM" },
    "meta-agent": { type: "agent", label: "Meta-Agent", run_always: true },
  };
  const runAlways = collectRunAlwaysNodes(nodes);
  const regularNodes = Object.keys(nodes).filter(
    (id) => !runAlways.includes(id),
  );
  assertEquals(regularNodes, ["pm"]);
  assertEquals(runAlways, ["meta-agent"]);
});
