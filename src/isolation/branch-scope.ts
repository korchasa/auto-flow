/**
 * @module
 * Write scope and tree isolation of a fork branch (FR-E37 / FR-E91 / FR-E95).
 *
 * Isolation is derived, not configured: a branch that declares where it may
 * write gets a worktree of its own, and a branch that declares nothing writes
 * nothing and runs in the tree the whole run shares. That keeps the two facts
 * a workflow author cares about — "what may this branch touch" and "can it
 * collide with its sibling" — in one field instead of two.
 * Entry points: {@link isolatedBranches}, {@link effectiveAllowedPaths}.
 */

import type { NodeConfig, WorkflowConfig } from "../types.ts";
import { resolveBranchMembership } from "../config/config.ts";

/** `"<group>.<branch>"` key for the branch a node belongs to. */
export function branchTreeKey(group: string, branch: string): string {
  return `${group}.${branch}`;
}

/**
 * The branches that need a worktree of their own.
 *
 * A branch qualifies when any of its nodes declares `allowed_paths`: that is
 * the workflow author saying this branch writes source, and two branches
 * writing source in one tree would overwrite each other.
 */
export function isolatedBranches(config: WorkflowConfig): Set<string> {
  const membership = resolveBranchMembership(config);
  const isolated = new Set<string>();
  for (const [id, own] of membership) {
    if (config.nodes[id]?.allowed_paths !== undefined) {
      isolated.add(branchTreeKey(own.group, own.branch));
    }
  }
  return isolated;
}

/**
 * The write scope the FR-E37 check runs against for one node.
 *
 * Outside a branch, an absent `allowed_paths` means no check at all — the
 * behaviour every existing workflow relies on. Inside a branch it means the
 * opposite: the branch declared no write scope, so it may write nothing, and
 * an empty list is what turns the check on to enforce that.
 */
export function effectiveAllowedPaths(
  node: NodeConfig,
  inBranch: boolean,
): string[] | undefined {
  if (node.allowed_paths !== undefined) return node.allowed_paths;
  return inBranch ? [] : undefined;
}
