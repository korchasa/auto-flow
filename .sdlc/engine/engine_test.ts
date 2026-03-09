import { assertEquals } from "@std/assert";
import type { EngineOptions } from "./types.ts";
import { Engine, resolveInputArtifacts } from "./engine.ts";

// Note: Full integration tests for Engine require claude CLI and a git repo.
// These tests verify options structure and dry-run behavior.

function makeOptions(overrides?: Partial<EngineOptions>): EngineOptions {
  return {
    config_path: ".sdlc/pipeline.yaml",
    verbosity: "quiet",
    args: { issue: "42" },
    env_overrides: {},
    ...overrides,
  };
}

Deno.test("EngineOptions — default structure", () => {
  const opts = makeOptions();
  assertEquals(opts.config_path, ".sdlc/pipeline.yaml");
  assertEquals(opts.verbosity, "quiet");
  assertEquals(opts.args.issue, "42");
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
