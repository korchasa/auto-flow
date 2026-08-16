/**
 * @module
 * FR-E91: derive the template context for a node that runs in a worktree of
 * its own.
 *
 * The engine's path contract (FR-E52) says `node_dir`, `run_dir` and
 * `input.<id>` are relative to the working directory the node's processes run
 * in, and every engine filesystem caller joins them back with
 * `workPath(ctx.workDir, …)`. An isolated node breaks that single-directory
 * assumption: its processes run in its own tree, while its artifacts must stay
 * in the run's shared tree so downstream nodes can read them.
 *
 * Absolute paths are what reconciles the two. Once an artifact path is
 * anchored at the shared tree, it means the same directory no matter which
 * working directory a process resolves it from — `workPath` returns it
 * untouched, and the prompt an agent reads points at the shared run directory
 * while its cwd is its own tree.
 */

import { resolve } from "@std/path";
import type { TemplateContext } from "../types.ts";

/** The three artifact-path fields of a {@link TemplateContext}. */
export interface TaskPaths {
  node_dir: string;
  run_dir: string;
  input: Record<string, string>;
}

/**
 * Anchor a context's artifact paths at `sharedWorkDir`, turning them from
 * workDir-relative into absolute.
 *
 * Takes the whole context but reads only its path fields, so the result can be
 * spread over the original.
 */
export function absolutizeTaskPaths(
  paths: TaskPaths,
  sharedWorkDir: string,
): TaskPaths {
  const abs = (p: string) => resolve(sharedWorkDir, p);
  return {
    node_dir: abs(paths.node_dir),
    run_dir: abs(paths.run_dir),
    input: Object.fromEntries(
      Object.entries(paths.input).map(([id, dir]) => [id, abs(dir)]),
    ),
  };
}

/**
 * Build the context an isolated node runs with: processes in `nodeWorkDir`,
 * artifacts still under `sharedWorkDir`.
 *
 * `workflow_dir` deliberately stays relative — it names a directory that
 * exists in every checkout of the repository, so a `flow_file()` lookup should
 * read the node's own tree, not the shared one.
 */
export function isolatedContext(
  ctx: TemplateContext,
  sharedWorkDir: string,
  nodeWorkDir: string,
): TemplateContext {
  return {
    ...ctx,
    ...absolutizeTaskPaths(ctx, sharedWorkDir),
    workDir: nodeWorkDir,
  };
}
