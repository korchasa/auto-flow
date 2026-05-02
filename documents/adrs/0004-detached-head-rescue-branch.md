# ADR-0004: Pin detached-HEAD worktrees to a rescue branch before removal

## Status

Accepted

## Context

`createWorktree` (FR-E24) uses `git worktree add --detach` so per-run
worktrees never pollute the main repo's branch namespace. If a workflow
makes commits inside the worktree but never explicitly checks out a
named branch, those commits are reachable only via the worktree's
`HEAD` ref. Once `removeWorktree` runs, the commits become unreachable
— the next `git gc` discards them.

Triggering incident: the `kazar-fairy-taler` autonomous-sdlc run lost
three commits (`be9bb6a → 12e6e93 → f6f6b94`) this way. Manual
`git reflog` archaeology recovered them, but only because the operator
noticed within the gc grace window. A silent loss in CI would have
been undetectable.

The detached-HEAD design itself is correct (the typical workflow path
through a `decision`-like agent that explicitly checks out a feature
branch is unaffected). The bug is the missing safety net for the
"agent committed but never branched" path.

## Decision

Before every `removeWorktree(workDir)` invocation, the engine calls
`pinDetachedHead(workDir, runId)`. The pin function:

- Inspects worktree HEAD via `git symbolic-ref --short HEAD`. If on a
  named branch → returns `undefined` (no-op).
- If detached → creates `flowai/run-<runId>-orphan-rescue` at HEAD via
  `git branch <name> HEAD` (non-destructive — never overwrites an
  existing branch).
- If a branch with that name already exists (resume of the same
  run-id, repeat invocation), appends `-2`, `-3`, ... until a free
  name is found.

Failure to pin emits `output.warn` but does NOT block worktree
removal — best-effort. A mid-run crash or corrupted ref must not
prevent cleanup.

## Consequences

- **Positive.** Commits made inside detached-HEAD worktrees survive
  worktree teardown, recoverable via the named rescue branch. The
  branch name is run-id-keyed, so `git branch | grep flowai/run-` is
  a one-liner audit of orphans. The typical "agent checked out a
  branch explicitly" path is unaffected (no-op when HEAD is on a
  named branch).
- **Negative.** Branch-namespace clutter — every detached-HEAD run
  with commits leaves a `flowai/run-...-orphan-rescue` branch in the
  main repo. Operators are expected to delete them after merging or
  discarding the contents. (Counter: the alternative is silent
  commit loss; a noisy branch is strictly less bad.)
- **Invariants.** `removeWorktree` is never called without a prior
  `pinDetachedHead`. Engine tests assert this via call-site coverage
  in `engine.ts` and a unit test for the pin function itself.
- **Cross-link.** Implements FR-E51 (see
  `documents/requirements-engine/04b-worktree-isolation.md` §3.51).

## Alternatives Considered

- **Refuse to remove worktrees with a detached HEAD that has
  unreachable commits.** Rejected — turns recovery into a manual
  operator step on every run; defeats the cleanup automation that is
  half the point of worktree isolation.
- **Force every worktree onto a named branch from the start
  (`--branch flowai/run-<runId>` instead of `--detach`).** Rejected —
  the workflows that DO check out a feature branch then have to
  delete the auto-created run branch first. Detached-by-default
  matches the intended common case (agents that don't care about
  branches).
- **Garbage-collect rescue branches after N days.** Rejected for now
  — adds a scheduling dimension without a triggering incident. Easy
  to add later if branch clutter becomes an operator complaint.
