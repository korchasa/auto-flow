# ADR-0003: Per-run worktree co-located under `<workflowDir>/runs/<run-id>/worktree/`

## Status

Accepted

## Context

Pre-FR-E57, every run's git worktree lived at a repo-global
`.flowai-workflow/worktrees/<run-id>/` path while the run's
`state.json` and per-node artifact directories lived at
`<workflowDir>/runs/<run-id>/`. The worktree was a sibling of the
repo, not of the run it served.

Two concrete problems followed:

- **Cross-workflow collision.** FR-E54 had already moved the run lock
  per workflow folder (`<workflowDir>/runs/.lock`), so two distinct
  workflow folders (e.g., `github-inbox/` and `github-inbox-opencode/`)
  could legitimately run at the same time. But both pointed at the
  same single `WORKTREE_BASE = ".flowai-workflow/worktrees"`, so a
  parallel run from workflow B could clobber workflow A's worktree
  namespace. The lock split was aspirational; FR-E54's own
  description called the worktree dir "already per-workflow" — which
  was untrue.
- **Operational hygiene.** Inspecting, archiving, or wiping a run
  required two unrelated paths. A bulk `rm -rf
  .flowai-workflow/<wf>/runs/<run-id>/` left the worktree behind as a
  stale gitlink; subsequent runs hit confusing
  "fatal: '<path>' is not a working tree" failures.

## Decision

Materialize each run's worktree at
`<workflowDir>/runs/<run-id>/worktree/`, sibling to its `state.json`
and node-artifact directories. `getWorktreePath`, `createWorktree`,
`worktreeExists`, and `Engine.run()` all take `workflowDir` as a
parameter and derive the path from it via
`deriveWorkflowDir(options.config_path)`. `removeWorktree` runs
`git worktree prune` after the primary remove to drop stale gitlinks
before the parent run dir is collected.

When `workflowDir === "."` (caller passed `workflow.yaml` without a
directory prefix) AND worktree mode is active, the engine fails fast
with a message naming FR-S47/FR-E53 — co-locating the worktree under
`./runs/...` is not gitignore-safe.

## Consequences

- **Positive.** A single path `<workflowDir>/runs/<run-id>/` contains
  everything tied to one run (state, artifacts, live worktree). Bulk
  ops, archival, and inspection operate on one tree. Cross-workflow
  parallel runs are fully isolated. The "already per-workflow"
  comment in FR-E54 is now true.
- **Negative.** Existing worktrees from older binaries are not
  relocated by this change — `git worktree add` writes an absolute
  gitdir path that survives the migration. Old paths must be cleaned
  up manually via `git worktree remove --force`. The fail-fast guard
  for `workflowDir === "."` is a breaking change for any caller that
  passed a bare `workflow.yaml`.
- **Invariants.** All path helpers in `worktree.ts` are parametrized by
  `workflowDir`. The engine never hard-codes
  `.flowai-workflow/worktrees`. Tests in `worktree_test.ts` cover the
  cross-workflow disjointness invariant.
- **Cross-link.** Implements FR-E57 (see
  `documents/requirements-engine/04b-worktree-isolation.md` §3.55).
  Builds on FR-E54 (per-workflow run lock; ADR-0006).

## Alternatives Considered

- **Keep `WORKTREE_BASE` global, namespace the runId by workflow
  hash.** Rejected — runtime-derived hash adds confusion; bulk ops
  still require two paths; nothing solves the gitlink-leak problem.
- **Always require explicit worktree path via env var.** Rejected —
  shifts the cross-workflow isolation contract onto the operator;
  every workflow folder would need its own env wiring.
- **Use temp dirs (`Deno.makeTempDir`) instead of in-tree
  worktrees.** Rejected — loses gitignore alignment, breaks
  `--resume` (temp dirs don't survive reboots), and orphans the
  artifact tree from its execution context.
