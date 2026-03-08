import { assertEquals } from "jsr:@std/assert";
import type { SafetyCheckResult } from "./git.ts";

// Note: Full git integration tests require a real git repo.
// These tests verify the data structures and logic patterns.
// Integration tests should be run in a temporary git repository.

Deno.test("SafetyCheckResult — no violations is safe", () => {
  const result: SafetyCheckResult = { safe: true, violations: [] };
  assertEquals(result.safe, true);
  assertEquals(result.violations.length, 0);
});

Deno.test("SafetyCheckResult — with violations is not safe", () => {
  const result: SafetyCheckResult = {
    safe: false,
    violations: [
      "Out-of-scope modification: .github/workflows/ci.yml",
      "Potential secret detected in diff content",
    ],
  };
  assertEquals(result.safe, false);
  assertEquals(result.violations.length, 2);
});

Deno.test("CommitResult — successful commit structure", () => {
  const result = {
    success: true,
    commitHash: "abc123def456",
  };
  assertEquals(result.success, true);
  assertEquals(typeof result.commitHash, "string");
});

Deno.test("CommitResult — nothing to commit", () => {
  const result = {
    success: true,
    commitHash: undefined,
  };
  assertEquals(result.success, true);
  assertEquals(result.commitHash, undefined);
});

Deno.test("CommitResult — failed commit", () => {
  const result = {
    success: false,
    error: "Git commit failed: not a git repository",
  };
  assertEquals(result.success, false);
  assertEquals(result.error!.includes("not a git repository"), true);
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
