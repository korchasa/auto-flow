import { assertEquals } from "@std/assert";
import { formatLeakMessage, runWithGuardrail } from "./guardrail.ts";

/**
 * FR-E91: when a level runs its nodes concurrently, the per-node guardrail is
 * switched off and one snapshot brackets the whole level. These tests cover
 * the switch itself; the level-scoped bracket is exercised end-to-end in
 * `node_isolation_test.ts`.
 */

Deno.test("FR-E91 runWithGuardrail — enabled: false skips the check entirely", async () => {
  let ran = false;
  const outcome = await runWithGuardrail(
    {
      // A repoRoot that is not a git repo: reaching git at all would throw,
      // so a passing test proves no snapshot was taken.
      repoRoot: "/nonexistent-repo-root",
      workDir: "runs/r1/worktree",
      allowedPaths: [],
      nodeId: "build",
      enabled: false,
    },
    () => {
      ran = true;
      return Promise.resolve("value");
    },
  );

  assertEquals(ran, true);
  assertEquals(outcome.result, "value");
  assertEquals(outcome.leak, undefined);
});

Deno.test("FR-E91 formatLeakMessage — scope kind defaults to node", () => {
  assertEquals(
    formatLeakMessage("build", ["a.ts"]),
    "[guardrail] node=build leaked 1 file(s): a.ts (rolled back)",
  );
});

Deno.test("FR-E91 formatLeakMessage — a level-scoped leak names the level", () => {
  assertEquals(
    formatLeakMessage("2 (build, test)", ["a.ts", "b.ts"], "level"),
    "[guardrail] level=2 (build, test) leaked 2 file(s): a.ts, b.ts (rolled back)",
  );
});
