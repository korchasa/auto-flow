import { assertEquals } from "@std/assert";
import { buildTaskPaths, getNodeDir, getRunDir, workPath } from "./state.ts";
import { interpolate } from "./template.ts";
import type { TemplateContext } from "./types.ts";

// Regression: see documents/tasks/2026-04-26-engine-cwd-relative-template-paths.md
//
// The bug was that ctx.node_dir / ctx.run_dir / ctx.input.<id> were emitted
// pre-prefixed with workDir (a path relative to the engine's cwd).
// Agents launched with cwd = workDir then resolved that relative path against
// workDir again — producing a doubly-nested non-existent path. Some agents
// "fixed" the broken path to an absolute path anchored at the project root,
// which silently leaked memory writes outside the worktree.
//
// Contract under test: paths in TemplateContext are workDir-RELATIVE; engine
// internal code joins them to workDir explicitly via workPath().

Deno.test("buildTaskPaths — node_dir is workDir-relative (no worktree prefix)", () => {
  const paths = buildTaskPaths("20260426T120000", "verify");
  assertEquals(
    paths.node_dir,
    getNodeDir("20260426T120000", "verify"),
  );
  // Sanity: workDir is not embedded.
  assertEquals(paths.node_dir.startsWith(".flowai-workflow/runs/"), true);
});

Deno.test("buildTaskPaths — run_dir is workDir-relative", () => {
  const paths = buildTaskPaths("20260426T120000", "verify");
  assertEquals(paths.run_dir, getRunDir("20260426T120000"));
});

Deno.test("buildTaskPaths — input map keys to workDir-relative node dirs", () => {
  const paths = buildTaskPaths("20260426T120000", "verify", [
    "specification",
    "decision",
  ]);
  assertEquals(
    paths.input.specification,
    getNodeDir("20260426T120000", "specification"),
  );
  assertEquals(
    paths.input.decision,
    getNodeDir("20260426T120000", "decision"),
  );
});

Deno.test("buildTaskPaths — empty inputs yields empty input map", () => {
  const paths = buildTaskPaths("R", "n");
  assertEquals(paths.input, {});
});

Deno.test("interpolate — rendered {{node_dir}} contains no worktree prefix even when workDir is a worktree", () => {
  // Simulate the issue #196 v3 scenario.
  const workDir = ".flowai-workflow/worktrees/20260425T222337";
  const paths = buildTaskPaths("20260425T222337", "verify");
  const ctx: TemplateContext = {
    ...paths,
    workDir,
    run_id: "20260425T222337",
    args: {},
    env: {},
    loop: undefined,
  };

  const rendered = interpolate("Read {{node_dir}}/05-qa-report.md", ctx);

  // Must NOT contain the worktree prefix — that would mean cwd=workDir
  // double-resolves into .../<workDir>/<workDir>/... non-existent path.
  assertEquals(rendered.includes(workDir), false);
  assertEquals(
    rendered,
    "Read .flowai-workflow/runs/20260425T222337/verify/05-qa-report.md",
  );
});

Deno.test("interpolate — rendered {{input.X}} contains no worktree prefix", () => {
  const workDir = ".flowai-workflow/worktrees/20260425T222337";
  const paths = buildTaskPaths("20260425T222337", "verify", [
    "specification",
  ]);
  const ctx: TemplateContext = {
    ...paths,
    workDir,
    run_id: "20260425T222337",
    args: {},
    env: {},
  };

  const rendered = interpolate(
    "Spec: {{input.specification}}/01-spec.md",
    ctx,
  );

  assertEquals(rendered.includes(workDir), false);
  // No phase registry set up in this test, so flat path layout (no "plan/").
  assertEquals(
    rendered,
    "Spec: .flowai-workflow/runs/20260425T222337/specification/01-spec.md",
  );
});

Deno.test("workPath(ctx.workDir, ctx.node_dir) reconstructs the FS path the engine reads", () => {
  // Engine internal code (cwd = main repo) must wrap ctx.node_dir with
  // workPath(ctx.workDir, …) to land on the actual file. This invariant
  // pins that contract.
  const workDir = ".flowai-workflow/worktrees/20260425T222337";
  const paths = buildTaskPaths("20260425T222337", "verify");
  const ctx: TemplateContext = {
    ...paths,
    workDir,
    run_id: "20260425T222337",
    args: {},
    env: {},
  };

  assertEquals(
    workPath(ctx.workDir, ctx.node_dir),
    `${workDir}/.flowai-workflow/runs/20260425T222337/verify`,
  );
});

Deno.test("TemplateContext — workDir defaults to '.' is no-op for workPath", () => {
  const paths = buildTaskPaths("R", "n");
  const ctx: TemplateContext = {
    ...paths,
    workDir: ".",
    run_id: "R",
    args: {},
    env: {},
  };
  // Sanity: with workDir=".", workPath is identity; legacy semantics preserved.
  assertEquals(workPath(ctx.workDir, ctx.node_dir), ctx.node_dir);
});
