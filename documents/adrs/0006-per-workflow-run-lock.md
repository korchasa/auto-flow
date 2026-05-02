# ADR-0006: Run lock is per-workflow-folder, rooted at `<workflowDir>/runs/.lock`

## Status

Accepted

## Context

FR-E25 introduced a single repo-global PID lock at
`.flowai-workflow/runs/.lock` to serialize concurrent
`Engine.run()` invocations and prevent two processes from clobbering
the same `state.json`. That contract was correct when there was only
one workflow per repo.

FR-S47 / FR-E53 then made multi-workflow layouts first-class — repos
ship `github-inbox/`, `github-inbox-opencode/`,
`github-inbox-opencode-test/`, and `autonomous-sdlc/` side by side.
Each owns its own `runs/` and `state.json` namespace. A repo-global
lock falsely serialized them, blocking parallel dogfood smoke runs
and any cross-workflow experimentation. The lock scope no longer
matched the actual isolation boundary.

## Decision

Make the lock per workflow folder. `defaultLockPath(workflowDir)`
returns `<workflowDir>/runs/.lock`. The engine derives `workflowDir`
once via `deriveWorkflowDir(options.config_path)` and threads it into
`acquireLock` / `releaseLock`. Two runs against the **same**
workflow folder still serialize (FR-E25 invariants — PID liveness
check, stale-lock reclaim on dead PID — preserved bit-for-bit).
Two runs against **different** workflow folders now proceed in
parallel because they hold independent lock files.

`EngineOptions.lock_path` test-only override still wins when set
(no auto-derivation when explicit). The legacy
`.flowai-workflow/runs/.lock` from older binaries is ignored as an
orphan file — never consulted, never cleaned up by the new code.

## Consequences

- **Positive.** Lock scope aligns with the actual isolation boundary
  (the workflow folder). Parallel dogfood runs across variants are
  unblocked. The contract is purely a function of `workflowDir`; no
  fallback magic.
- **Negative.** Stale repo-global lock files in long-lived checkouts
  are now inert orphans. Operators that scripted around the old path
  must update. Worktree namespace was NOT yet per-workflow at FR-E54
  time (that was ADR-0003 / FR-E57's job) — the FR-E54 change alone
  could have allowed cross-workflow worktree collisions; FR-E57
  closes the gap.
- **Invariants.** Lock path is purely a function of `workflowDir`.
  No fallback to the legacy global path. PID-liveness and stale-
  reclaim semantics carry over from FR-E25 unchanged. Tests in
  `lock_test.ts` cover both same-folder serialization and distinct-
  folder concurrency.
- **Cross-link.** Implements FR-E54 (see
  `documents/requirements-engine/04b-worktree-isolation.md` §3.54).
  Aspirational claim in FR-E54 about per-workflow worktrees made
  real by ADR-0003.

## Alternatives Considered

- **OS-level advisory lock (`flock`) on the workflow folder.**
  Rejected — Deno has no portable `flock` binding; would force a
  shell-out per acquisition; doesn't survive process crashes any
  better than a file with a PID.
- **Shared SQLite registry of running runs.** Rejected — adds a
  dependency, a schema, and a cross-platform DB file for what is
  fundamentally a one-bit "is anyone here" question. The PID file
  works.
- **No lock; trust workflow operators not to overlap runs.** Rejected
  — concurrent runs against the same workflow folder corrupt
  `state.json` deterministically; the lock is load-bearing.
