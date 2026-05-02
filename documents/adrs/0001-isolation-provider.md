# ADR-0001: Engine domain-agnostic via pluggable IsolationProvider

## Status

Proposed

## Context

Engine's mandate (`AGENTS.md` Key Decisions, `requirements-engine/00-meta.md`
§NFR Domain-agnostic) forbids any git, GitHub, branch, PR, or other
domain-specific code in `engine/*.ts`. The current worktree subsystem
(`worktree.ts` + `guardrail.ts` + `lock.ts`) violates that mandate: it
shells out to `git worktree`, `git status --porcelain`, `git checkout
--`, `git branch`, `git ls-files --others --ignored --exclude-standard`,
and `git push` in roughly a dozen call-sites threaded through
`engine.ts`, `node-dispatch.ts`, and `validate.ts`. FR-E24, FR-E50,
FR-E51, FR-E52, FR-E54, FR-E57, FR-E58 all encode «git worktree» as if
it were the only isolation primitive. A workflow that wants Docker-
container isolation, ZFS-snapshot isolation, or no-isolation-at-all
has no extension point — it must fork the engine.

Triggering forces:

- Task `documents/tasks/2026-05-01-isolation-provider-plugin.md`.
- Two real incidents (`engine` issue #196 and `kazar-fairy-taler`
  memory leak) treated under FR-E50 as worktree-specific failures
  rather than as a generic "isolation contract violation" class.
- `documents/tasks/2026-05-01-engine-decomposition.md` is blocked by
  this — the god-class can't be cleanly split until git is behind an
  interface.

## Decision

Define an `IsolationProvider` interface in `isolation/types.ts` with the
operations the engine actually consumes: `setup(runId, ref?) →
{workDir}`, `teardown(workDir, opts) → {rescueRef?}`, `snapshot(workDir)
→ Tree`, `diffAndRollback(before, after, allowedPaths)`,
`copySupportFiles(workDir)`, `acquireLock(workflowDir)`. Move the
existing git-worktree logic into `isolation/git-worktree/` as the
default implementation registered under name `git-worktree`. Engine
selects via workflow `defaults.isolation: <name>`; default name remains
`git-worktree` to preserve current behaviour. Workflow YAML schema
gains `isolation: "git-worktree" | "none" | <plugin-name>`. New
implementations land in their own module trees, never under root-level
`*.ts`.

## Consequences

- **Positive.** Engine becomes truly domain-agnostic — `engine.ts` and
  friends no longer import `worktree.ts` directly; they go through
  `IsolationProvider`. Decomposition (next task) becomes mechanical.
  Future Docker/ZFS/none providers ship as separate modules without
  touching engine core. Worktree-specific FRs (FR-E50/E51/E52/E54/E57/
  E58) get a coherent home — they describe one provider, not "the"
  isolation behaviour.
- **Negative.** One indirection added on every isolated call (negligible
  runtime cost; large readability cost while the migration is in
  flight). Test-only `EngineOptions.lock_path` override needs an
  equivalent escape hatch on the provider. Existing FR acceptance
  criteria reference `worktree.ts` line numbers — those move and the
  evidence pointers must update at the same time.
- **Invariants.** Engine modules MUST NOT `import` from
  `isolation/git-worktree/`. Audit test in
  `isolation_boundary_test.ts` (planned) greps engine-side files for
  forbidden imports. The provider name is the only knob exposed to
  workflow YAML — no per-call overrides.

## Alternatives Considered

- **Keep status quo, rename modules only.** Rejected — does not unblock
  decomposition or new providers; trades real coupling for cosmetic
  reorg.
- **Embed git directly in `engine.ts` and gate via feature flag.**
  Rejected — every alternative isolation primitive becomes a flag, and
  the «domain-agnostic» NFR collapses into «git is special, all others
  are flags».
- **Plugin discovery via filesystem (drop a module in
  `~/.flowai/isolation/`).** Rejected for now — adds a runtime loader
  and a security surface the engine doesn't otherwise have. In-tree
  registration + JSR-published add-on packages cover the foreseeable
  use cases.
