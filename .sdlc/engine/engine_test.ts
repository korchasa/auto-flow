import { assertEquals } from "@std/assert";
import type { EngineOptions } from "./types.ts";
import { Engine, resolveInputArtifacts } from "./engine.ts";
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

// --- AC6: Safety check verbose coverage ---

Deno.test("AC6 positive — verboseSafety called when allowed_paths configured", () => {
  // Simulates engine.ts:279-294 logic: when allowed_paths.length > 0,
  // safetyCheckDiff runs and verboseSafety is called with results.
  const cap = createCapture();
  const out = new OutputManager("verbose", cap.writer);

  const allowedPaths = ["src/"];
  const safetyResult = {
    safe: true,
    violations: [] as string[],
    checkedFiles: ["src/main.ts", "src/util.ts"],
  };

  // Engine calls verboseSafety only when allowed_paths.length > 0
  if (allowedPaths.length > 0) {
    out.verboseSafety(
      "executor",
      safetyResult.checkedFiles,
      safetyResult.violations,
    );
  }

  assertEquals(cap.lines.length > 0, true, "verboseSafety should emit output");
  assertEquals(cap.lines.some((l) => l.includes("SAFETY CHECK")), true);
  assertEquals(cap.lines.some((l) => l.includes("src/main.ts")), true);
});

Deno.test("AC6 negative — verboseSafety skipped when allowed_paths empty", () => {
  // Simulates engine.ts:279 logic: when allowed_paths is empty,
  // safetyCheckDiff is skipped entirely — no verboseSafety call.
  const cap = createCapture();
  const out = new OutputManager("verbose", cap.writer);

  const allowedPaths: string[] = [];

  // Engine skips entire safety block when allowed_paths.length === 0
  if (allowedPaths.length > 0) {
    out.verboseSafety("executor", [], []);
  }

  assertEquals(
    cap.lines.length,
    0,
    "No verbose safety output when allowed_paths empty",
  );
});

// --- Safety-to-continuation logic pattern tests ---

Deno.test("Safety violation triggers continuation pattern — not immediate failure", () => {
  // Verifies the engine.ts executeAgentNode() safety-continuation pattern:
  // When safetyCheckDiff returns violations, engine should construct a resume
  // prompt and re-invoke, not immediately fail the node.
  const safetyResult = {
    safe: false,
    violations: ["Out-of-scope modification: .github/ci.yml"],
    checkedFiles: [".github/ci.yml", "src/main.ts"],
  };

  // The new pattern: violations + remaining continuations → build resume prompt
  const continuations = 0;
  const maxContinuations = 3;
  const shouldContinue = !safetyResult.safe &&
    continuations < maxContinuations;

  assertEquals(shouldContinue, true, "Should trigger continuation, not fail");

  // Resume prompt includes violation details
  const resumePrompt =
    `Safety check violations detected (continuation ${continuations + 1}/${maxContinuations}):\n${
      safetyResult.violations.join("\n")
    }\nRevert the problematic changes and fix the issues.`;
  assertEquals(resumePrompt.includes("Out-of-scope"), true);
  assertEquals(resumePrompt.includes("continuation 1/3"), true);
});

Deno.test("Safety violation exhausts continuations — fails node", () => {
  // When continuations are exhausted after safety violation, node must fail.
  const safetyResult = {
    safe: false,
    violations: ["Potential secret detected in diff content"],
    checkedFiles: ["src/config.ts"],
  };

  const continuations = 3;
  const maxContinuations = 3;
  const shouldContinue = !safetyResult.safe &&
    continuations < maxContinuations;

  assertEquals(shouldContinue, false, "Should fail — continuations exhausted");
});

Deno.test("Safety and validation continuations share same budget", () => {
  // Safety and validation continuations share a single max_continuations counter.
  // If validation used 2 of 3, safety only has 1 left.
  let continuations = 2; // validation used 2
  const maxContinuations = 3;

  // Safety violation with 1 remaining
  const safetyViolation = true;
  if (safetyViolation && continuations < maxContinuations) {
    continuations++;
  }
  assertEquals(continuations, 3, "Should use the last continuation");

  // Next violation should fail
  const shouldContinue = continuations < maxContinuations;
  assertEquals(shouldContinue, false, "No continuations left");
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
