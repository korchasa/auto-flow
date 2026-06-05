import { assertEquals } from "@std/assert";
import { detectLeaks, formatLeakMessage } from "./guardrail.ts";

// FR-E50: pure detection logic for files modified by an agent in the main
// repo working tree, outside its assigned worktree and outside the node's
// allowed_paths. Symmetric to FR-E37 (`scope-check.ts`) which guards the
// inside-worktree side.

Deno.test("detectLeaks — empty diff yields no leaks", () => {
  const before = new Set([".flowai-workflow/runs/old/state.json"]);
  const after = new Set([".flowai-workflow/runs/old/state.json"]);
  assertEquals(detectLeaks(before, after, "wt", []), []);
});

Deno.test("detectLeaks — paths inside workDir are never leaks", () => {
  const before = new Set<string>();
  const after = new Set([
    "wt/.flowai-workflow/runs/X/verify/05-qa-report.md",
    "wt/.flowai-workflow/memory/agent-qa.md",
  ]);
  assertEquals(detectLeaks(before, after, "wt", []), []);
});

Deno.test("detectLeaks — path outside workDir and outside allowed_paths is a leak", () => {
  const before = new Set<string>();
  const after = new Set([".flowai-workflow/memory/agent-qa.md"]);
  const leaks = detectLeaks(before, after, "wt", []);
  assertEquals(leaks, [".flowai-workflow/memory/agent-qa.md"]);
});

Deno.test("detectLeaks — pre-existing modifications are excluded", () => {
  // Path was already dirty before agent ran — agent did not cause it.
  const before = new Set([".flowai-workflow/memory/agent-qa.md"]);
  const after = new Set([".flowai-workflow/memory/agent-qa.md"]);
  assertEquals(detectLeaks(before, after, "wt", []), []);
});

Deno.test("detectLeaks — paths matching allowed_paths globs are not leaks", () => {
  const before = new Set<string>();
  const after = new Set([
    "documents/foo.md",
    "documents/bar/baz.md",
    "src/main.ts",
  ]);
  const leaks = detectLeaks(before, after, "wt", ["documents/**", "src/*.ts"]);
  assertEquals(leaks, []);
});

Deno.test("detectLeaks — paths not matching allowed_paths are leaks", () => {
  const before = new Set<string>();
  const after = new Set([
    "documents/foo.md", // allowed
    ".flowai-workflow/memory/agent-qa.md", // not allowed
    "src/secret.ts", // not allowed by glob
  ]);
  const leaks = detectLeaks(before, after, "wt", ["documents/**"]);
  // src/secret.ts and memory file leak; documents/ is whitelisted.
  assertEquals(leaks.sort(), [
    ".flowai-workflow/memory/agent-qa.md",
    "src/secret.ts",
  ]);
});

Deno.test("detectLeaks — workDir as `.` (no worktree) means everything outside allowed_paths leaks", () => {
  // Caller is expected to skip detectLeaks entirely when workDir === ".".
  // But if invoked, behavior must be deterministic: nothing has the
  // ".//" prefix, so workDir filter is a no-op; only allowed_paths filter
  // applies. This documents the contract.
  const before = new Set<string>();
  const after = new Set(["foo.md", "bar.md"]);
  assertEquals(detectLeaks(before, after, ".", ["foo.md"]), ["bar.md"]);
});

Deno.test("detectLeaks — workDir prefix match requires trailing slash semantic", () => {
  // Path "wtreeneighbor/x" should NOT count as inside "wtree".
  const before = new Set<string>();
  const after = new Set([
    "wtree/inside.md", // inside workDir
    "wtreeneighbor/outside.md", // sibling dir, NOT inside
  ]);
  const leaks = detectLeaks(before, after, "wtree", []);
  assertEquals(leaks, ["wtreeneighbor/outside.md"]);
});

Deno.test("detectLeaks — multiple allowed_paths globs all considered", () => {
  const before = new Set<string>();
  const after = new Set([
    "a/x.md",
    "b/y.md",
    "c/z.md", // matches none
  ]);
  const leaks = detectLeaks(before, after, "wt", ["a/**", "b/**"]);
  assertEquals(leaks, ["c/z.md"]);
});

Deno.test("detectLeaks — empty allowed_paths means only workDir is whitelist", () => {
  const before = new Set<string>();
  const after = new Set(["wt/in.md", "out.md"]);
  assertEquals(detectLeaks(before, after, "wt", []), ["out.md"]);
});

Deno.test("formatLeakMessage — default verbosity", () => {
  const msg = formatLeakMessage("verify", [
    ".flowai-workflow/memory/agent-qa.md",
    ".flowai-workflow/memory/agent-qa-history.md",
  ]);
  assertEquals(
    msg,
    "[guardrail] node=verify leaked 2 file(s): .flowai-workflow/memory/agent-qa.md, .flowai-workflow/memory/agent-qa-history.md (rolled back)",
  );
});

Deno.test("formatLeakMessage — single file", () => {
  const msg = formatLeakMessage("build", ["src/main.ts"]);
  assertEquals(
    msg,
    "[guardrail] node=build leaked 1 file(s): src/main.ts (rolled back)",
  );
});
