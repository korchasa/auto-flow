// FR-E37: scope-based file modification detection (allowed_paths).
import { assertEquals } from "@std/assert";
import { findViolations, snapshotModifiedFiles } from "./scope-check.ts";

// --- findViolations pure function tests ---

Deno.test("findViolations — no violations: new mod matches allowed glob", () => {
  const before = new Set<string>();
  const after = new Set(["engine/agent.ts"]);
  assertEquals(findViolations(before, after, ["engine/**"]), []);
});

Deno.test("findViolations — violation detected: new mod not in allowed paths", () => {
  const before = new Set<string>();
  const after = new Set(["documents/design.md"]);
  assertEquals(findViolations(before, after, ["engine/**"]), [
    "documents/design.md",
  ]);
});

Deno.test("findViolations — pre-existing mods excluded from violations", () => {
  const before = new Set(["docs/readme.md"]);
  // docs/readme.md is pre-existing (in before), engine/agent.ts is new but allowed
  const after = new Set(["docs/readme.md", "engine/agent.ts"]);
  assertEquals(findViolations(before, after, ["engine/**"]), []);
});

Deno.test("findViolations — empty sets: no violations", () => {
  assertEquals(findViolations(new Set(), new Set(), ["engine/**"]), []);
});

Deno.test("findViolations — empty allowed paths: all new mods are violations", () => {
  const before = new Set<string>();
  const after = new Set(["engine/agent.ts"]);
  assertEquals(findViolations(before, after, []), ["engine/agent.ts"]);
});

Deno.test("findViolations — glob: * matches within single segment only", () => {
  const before = new Set<string>();
  const after = new Set(["engine/agent.ts", "engine/types.ts"]);
  assertEquals(findViolations(before, after, ["engine/*.ts"]), []);
});

Deno.test("findViolations — glob: * does not match across path separator", () => {
  const before = new Set<string>();
  const after = new Set(["engine/sub/agent.ts"]);
  // engine/*.ts should NOT match engine/sub/agent.ts
  assertEquals(findViolations(before, after, ["engine/*.ts"]), [
    "engine/sub/agent.ts",
  ]);
});

Deno.test("findViolations — glob: ** matches multiple path segments", () => {
  const before = new Set<string>();
  const after = new Set(["engine/sub/agent.ts", "engine/deep/sub/file.ts"]);
  assertEquals(findViolations(before, after, ["engine/**"]), []);
});

Deno.test("findViolations — multiple allowed paths: match against any", () => {
  const before = new Set<string>();
  const after = new Set(["engine/agent.ts", "engine/scope-check_test.ts"]);
  assertEquals(
    findViolations(before, after, ["engine/*.ts", "engine/*_test.ts"]),
    [],
  );
});

Deno.test("findViolations — multiple violations: all returned", () => {
  const before = new Set<string>();
  const after = new Set([
    "engine/agent.ts",
    ".github/workflow.yaml",
    ".flowai-workflow/scripts/foo.sh",
  ]);
  const violations = findViolations(before, after, ["engine/**"]);
  assertEquals(violations.length, 2);
  assertEquals(violations.includes(".github/workflow.yaml"), true);
  assertEquals(violations.includes(".flowai-workflow/scripts/foo.sh"), true);
  assertEquals(violations.includes("engine/agent.ts"), false);
});

Deno.test("findViolations — exact path match", () => {
  const before = new Set<string>();
  const after = new Set(["engine/agent.ts"]);
  assertEquals(findViolations(before, after, ["engine/agent.ts"]), []);
});

// --- snapshotModifiedFiles integration test ---

Deno.test("snapshotModifiedFiles — returns a Set of strings", async () => {
  const snapshot = await snapshotModifiedFiles();
  assertEquals(snapshot instanceof Set, true);
  for (const entry of snapshot) {
    assertEquals(typeof entry, "string");
    assertEquals(entry.length > 0, true);
  }
});
