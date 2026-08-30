import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { absolutizeTaskPaths, isolatedContext } from "./node-isolation.ts";
import { workPath } from "../state/state.ts";
import type { TemplateContext } from "../types.ts";

const SHARED = ".flowai-workflow/wf/runs/R1/worktree";
const NODE_TREE = ".flowai-workflow/wf/runs/R1/worktrees/build";

function baseCtx(): TemplateContext {
  return {
    node_dir: ".flowai-workflow/wf/runs/R1/build",
    run_dir: ".flowai-workflow/wf/runs/R1",
    input: { plan: ".flowai-workflow/wf/runs/R1/plan" },
    run_id: "R1",
    workDir: SHARED,
    workflow_dir: ".flowai-workflow/wf",
    args: {},
    env: {},
  };
}

Deno.test("FR-E91 absolutizeTaskPaths anchors artifact paths at the shared work dir", () => {
  const paths = absolutizeTaskPaths(baseCtx(), SHARED);

  assertEquals(
    paths.node_dir,
    resolve(SHARED, ".flowai-workflow/wf/runs/R1/build"),
  );
  assertEquals(paths.run_dir, resolve(SHARED, ".flowai-workflow/wf/runs/R1"));
  assertEquals(
    paths.input.plan,
    resolve(SHARED, ".flowai-workflow/wf/runs/R1/plan"),
  );
});

Deno.test("FR-E91 isolatedContext points the node at its own tree but keeps artifacts shared", () => {
  const ctx = isolatedContext(baseCtx(), SHARED, NODE_TREE);

  assertEquals(ctx.workDir, NODE_TREE);
  assertEquals(ctx.run_id, "R1");
  assertEquals(ctx.workflow_dir, ".flowai-workflow/wf");
  // The artifact directory still lives under the run's shared tree, so a
  // downstream node reading {{input.build}} finds it.
  assertEquals(
    ctx.node_dir,
    resolve(SHARED, ".flowai-workflow/wf/runs/R1/build"),
  );
});

Deno.test("FR-E91 workPath leaves an already-absolute artifact path alone", () => {
  const ctx = isolatedContext(baseCtx(), SHARED, NODE_TREE);
  // Every engine FS caller wraps a context path with workPath before use. For
  // an isolated node that path is absolute, so the wrap must be a no-op —
  // otherwise the node's own tree would be prefixed onto the shared path.
  assertEquals(workPath(ctx.workDir, ctx.node_dir), ctx.node_dir);
});

Deno.test("FR-E91 isolatedContext preserves branch.* on a branch node", () => {
  const item = { ...baseCtx(), branch: { index: 2, value: "b.ts", key: "2" } };
  const ctx = isolatedContext(item, SHARED, NODE_TREE);
  assertEquals(ctx.branch, { index: 2, value: "b.ts", key: "2" });
});
