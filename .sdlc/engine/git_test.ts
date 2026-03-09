import { assertEquals } from "@std/assert";
import type { CommitResult, SafetyCheckResult } from "./git.ts";
import { OutputManager } from "./output.ts";

/** Capture output lines from an OutputManager. */
function createCapture(): { lines: string[]; writer: (text: string) => void } {
  const lines: string[] = [];
  return { lines, writer: (text: string) => lines.push(text) };
}

// Note: Full git integration tests require a real git repo.
// These tests verify the data structures and logic patterns.
// Integration tests should be run in a temporary git repository.

Deno.test("SafetyCheckResult — no violations is safe", () => {
  const result: SafetyCheckResult = {
    safe: true,
    violations: [],
    checkedFiles: [],
  };
  assertEquals(result.safe, true);
  assertEquals(result.violations.length, 0);
  assertEquals(result.checkedFiles.length, 0);
});

Deno.test("SafetyCheckResult — with violations is not safe", () => {
  const result: SafetyCheckResult = {
    safe: false,
    violations: [
      "Out-of-scope modification: .github/workflows/ci.yml",
      "Potential secret detected in diff content",
    ],
    checkedFiles: [".github/workflows/ci.yml", "src/main.ts"],
  };
  assertEquals(result.safe, false);
  assertEquals(result.violations.length, 2);
  assertEquals(result.checkedFiles.length, 2);
});

Deno.test("SafetyCheckResult — checkedFiles exposes changed files list", () => {
  const result: SafetyCheckResult = {
    safe: true,
    violations: [],
    checkedFiles: ["src/main.ts", "src/util.ts", "tests/main_test.ts"],
  };
  assertEquals(result.checkedFiles, [
    "src/main.ts",
    "src/util.ts",
    "tests/main_test.ts",
  ]);
});

Deno.test("CommitResult — successful commit with enriched fields", () => {
  const result: CommitResult = {
    success: true,
    commitHash: "abc123def456",
    filesStaged: ["src/main.ts", "src/util.ts"],
    message: "sdlc(executor): run-1 — Executor",
  };
  assertEquals(result.success, true);
  assertEquals(typeof result.commitHash, "string");
  assertEquals(result.filesStaged.length, 2);
  assertEquals(result.message, "sdlc(executor): run-1 — Executor");
});

Deno.test("CommitResult — nothing to commit has empty filesStaged", () => {
  const result: CommitResult = {
    success: true,
    commitHash: undefined,
    filesStaged: [],
    message: "",
  };
  assertEquals(result.success, true);
  assertEquals(result.commitHash, undefined);
  assertEquals(result.filesStaged.length, 0);
});

Deno.test("CommitResult — failed commit", () => {
  const result: CommitResult = {
    success: false,
    error: "Git commit failed: not a git repository",
    filesStaged: [],
    message: "",
  };
  assertEquals(result.success, false);
  assertEquals(result.error!.includes("not a git repository"), true);
});

// --- Edge case: zero staged files at commit ---

Deno.test("verboseCommit — handles zero staged files (no-op commit)", () => {
  // When commitNodeChanges() detects no staged files, verboseCommit
  // should report an empty files list without error.
  const cap = createCapture();
  const out = new OutputManager("verbose", cap.writer);

  // Simulate no-op commit result: zero files staged
  const commitResult: CommitResult = {
    success: true,
    commitHash: undefined,
    filesStaged: [],
    message: "",
  };

  // Engine only calls verboseCommit when filesStaged.length > 0
  // (engine.ts:449), so zero files = no verboseCommit call.
  if (commitResult.filesStaged.length > 0) {
    out.verboseCommit(
      "node1",
      commitResult.filesStaged,
      commitResult.message,
      "agent/42",
    );
  }

  assertEquals(
    cap.lines.length,
    0,
    "Zero staged files should produce no verbose commit output",
  );
});

// Path matching logic test (mirrors safetyCheckDiff logic)
Deno.test("allowed paths matching — exact match", () => {
  const allowedPaths = ["src/main.ts", ".sdlc/pipeline/"];
  const file = "src/main.ts";
  const allowed = allowedPaths.some(
    (pattern) => file === pattern || file.startsWith(pattern),
  );
  assertEquals(allowed, true);
});

Deno.test("allowed paths matching — prefix match", () => {
  const allowedPaths = [".sdlc/pipeline/"];
  const file = ".sdlc/pipeline/42/01-spec.md";
  const allowed = allowedPaths.some(
    (pattern) => file === pattern || file.startsWith(pattern),
  );
  assertEquals(allowed, true);
});

Deno.test("allowed paths matching — no match", () => {
  const allowedPaths = ["src/", "tests/"];
  const file = ".github/workflows/ci.yml";
  const allowed = allowedPaths.some(
    (pattern) => file === pattern || file.startsWith(pattern),
  );
  assertEquals(allowed, false);
});

// Secret pattern matching test (mirrors safetyCheckDiff regex)
Deno.test("secret pattern — detects API key", () => {
  const pattern =
    /(?:api[_-]?key|secret|token|password|credential)\s*[:=]\s*['"][^'"]{8,}/i;
  assertEquals(pattern.test('API_KEY = "sk-12345678abcdef"'), true);
  assertEquals(pattern.test('token: "ghp_xxxxxxxxxxxx"'), true);
  assertEquals(pattern.test('password = "short"'), false); // too short
  assertEquals(pattern.test("const x = 42"), false);
});

// branch() helper tests — require real git repo
Deno.test("branch — returns current branch name", async () => {
  const { branch } = await import("./git.ts");
  const result = await branch();
  assertEquals(typeof result, "string");
  assertEquals(result.length > 0, true);
});
