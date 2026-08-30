import { assertEquals } from "@std/assert";
import { formatLeakMessage, runWithGuardrail } from "./guardrail.ts";

/**
 * FR-E91: when several nodes run at once, the per-node guardrail is switched
 * off and one snapshot brackets the whole running set. These tests cover the
 * switch and the message; the group-scoped bracket is exercised end-to-end in
 * `isolation_e2e_test.ts`.
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

Deno.test("FR-E91 formatLeakMessage — a group-scoped leak names every member", () => {
  assertEquals(
    formatLeakMessage("build, test", ["a.ts", "b.ts"], "group"),
    "[guardrail] group=build, test leaked 2 file(s): a.ts, b.ts (rolled back)",
  );
});
