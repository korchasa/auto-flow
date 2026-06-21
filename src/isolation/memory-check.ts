/**
 * @module
 * Reflection-memory dirty-file detector for the per-agent commit-step
 * enforcement (FR-S28).
 *
 * After each agent invocation under worktree isolation, the engine snapshots
 * the worktree's working tree and asserts that no path matching the
 * configured `defaults.memory_paths` globs is left dirty (uncommitted).
 * Nodes opting out via `memory_commit_deferred: true` skip this check.
 *
 * Domain-agnostic: globs come from workflow YAML, NOT from engine code.
 */

import { globMatch } from "./glob.ts";
import { snapshotModifiedFiles } from "./scope-check.ts";

/**
 * Find dirty paths in `workDir` that match any glob in `memoryPaths`.
 *
 * Returns an empty array when `memoryPaths` is empty (the workflow opted
 * out of memory enforcement) or when nothing dirty matches.
 *
 * Pure I/O wrapper around {@linkcode snapshotModifiedFiles} + glob filter.
 */
export async function findDirtyMemoryFiles(
  workDir: string,
  memoryPaths: readonly string[],
): Promise<string[]> {
  if (memoryPaths.length === 0) return [];
  const cwd = workDir === "." ? undefined : workDir;
  const snapshot = await snapshotModifiedFiles(cwd);
  const dirty: string[] = [];
  for (const path of snapshot) {
    if (memoryPaths.some((pattern) => globMatch(pattern, path))) {
      dirty.push(path);
    }
  }
  return dirty;
}

/**
 * Format a single-line memory-violation message for `markNodeFailed`.
 *
 * Tells the operator which paths were dirty, names the override flag, and
 * makes the message greppable via the `[memory-check]` prefix.
 */
export function formatMemoryViolation(
  nodeId: string,
  dirtyPaths: readonly string[],
): string {
  return `[memory-check] node=${nodeId} left ${dirtyPaths.length} memory file(s) uncommitted: ${
    dirtyPaths.join(", ")
  }. Commit them or set 'memory_commit_deferred: true' on this node.`;
}
