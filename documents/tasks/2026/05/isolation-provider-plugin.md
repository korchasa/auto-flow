---
date: "2026-05-01"
status: superseded
implements: [FR-E24, FR-E50, FR-E51, FR-E52, FR-E54, FR-E57, FR-E58, FR-E59, FR-E60, FR-E61]
superseded_by: 2026/05/remove-git-from-engine.md
tags: [refactor, isolation, plugin, engine, sdlc]
related_tasks:
  - 2026/05/isolation-provider.md
  - 2026/05/remove-git-from-engine.md
  - 2026/05/engine-decomposition.md
  - 2026/05/worktree-frs-consolidation.md
---
# engine+sdlc: Extract worktree into pluggable IsolationProvider

## Goal

Restore the "domain-agnostic engine" invariant. Engine must not know about
git, branches, detached HEAD, or `origin/<base>`. SDLC workflows that need
git isolation configure a plugin; pure-DAG workflows opt out.

## Overview

### Context

Critique #1: engine.ts directly orchestrates worktree creation, ignored-file
mirror, detached-HEAD pinning, and `git worktree remove`. Seven FR-E
(E24, E50–E58) describe one git-coupled subsystem. AGENTS.md asserts
"MUST NOT contain git, GitHub, branch, PR, or any domain-specific logic" —
the assertion is currently false.

### Current State

- `engine.ts:159-178,341-384` calls `createWorktree`, `pinDetachedHead`,
  `removeWorktree`, `copyIgnoredIntoWorktree` directly.
- `worktree.ts` (385 lines) hardcodes `git worktree add`, `--checkout
  origin/<base>`, rescue-branch naming.
- `WorkflowDefaults.worktree_disabled` is the only knob; type-level coupling.
- All four bundled workflows depend on git-worktree isolation.

### Constraints

- No regression in current SDLC runs — git-worktree behavior must remain
  byte-identical when configured.
- Library-embedding contract (FR-E59/E60/E61) preserved.
- Resume path (`--resume`) must work across the new boundary.
- Ship as a single PR (no half-extracted state — engine and provider land
  together).

> **Note:** This plugin approach was later superseded by
> `2026/05/remove-git-from-engine.md` (full removal preferred
> over indirection). Kept here as historical record.

## Definition of Done

- [ ] New interface `IsolationProvider` with methods `setup(runId, ctx) →
      { workDir, meta }`, `teardown(runId, success, ctx)`, `resolveExisting
      (runId) → workDir | undefined`, `mirrorIgnored?(workDir)`.
- [ ] Two built-in providers: `git-worktree` (current behavior) and `none`
      (workDir = ".").
- [ ] `engine.ts` calls only the interface — zero `git`/worktree imports
      remain.
- [ ] `WorkflowConfig` gains `isolation: { type: "git-worktree" | "none",
      ... }` (replaces `worktree_disabled`; back-compat alias kept one
      release).
- [ ] All four `.flowai-workflow/*/workflow.yaml` updated to declare
      `isolation: git-worktree`.
- [ ] Engine SRS + SDS rewritten: FR-E24/E50/E51/E52/E57/E58 marked
      "fulfilled by IsolationProvider contract"; provider-specific FRs
      moved to a new `documents/requirements-providers/git-worktree.md`.
      No git terminology left in engine SRS/SDS.
- [ ] AGENTS.md "Architecture" + "Key Decisions" sections rewritten.
      "Worktree base ref" subsection moves to provider docs.
- [ ] README.md updated: isolation framed as plugin.
- [ ] All existing worktree tests pass against the `git-worktree` provider
      via the public interface (no engine internals reached).
- [ ] New unit tests: provider contract conformance, `none` provider
      behavior, provider selection from config.
- [ ] Decision captured in `2026/05/isolation-provider.md`.

## Solution

### Phase 1 — Interface + extraction

1. Define `IsolationProvider` in new `isolation.ts`. Move `worktree.ts`
   logic behind it as `git-worktree-provider.ts`.
2. Add `none-provider.ts` (no-op: `setup → { workDir: "." }`, `teardown
   → noop`).
3. Provider selector: `selectProvider(config) → IsolationProvider`.
4. Engine constructor takes provider; `EngineOptions.isolation?` override
   (tests).

### Phase 2 — Engine cleanup

5. Replace direct `createWorktree`/`removeWorktree`/etc. calls in
   `engine.ts` with provider methods.
6. Move `copyIgnoredIntoWorktree` into git-worktree provider as
   `mirrorIgnored`.
7. Remove `worktree_disabled` from `WorkflowDefaults` type after grace
   release.

### Phase 3 — Doc rewrite (mandatory part of "B + reflect everywhere")

8. SRS engine: rewrite §4b worktree-isolation → §4b "Isolation contract";
   move git-specific acceptance criteria to new provider SRS.
9. SDS engine: same restructure.
10. AGENTS.md: rewrite "Architecture" §4 "worktree base ref" → "isolation
    contract"; mention git-worktree as the default-shipped provider.
11. README: 2-paragraph update.
12. decision-task `isolation-provider.md` documents the
    architectural pivot.

### Verification

- `deno task check` green.
- `deno task run .flowai-workflow/github-inbox` (existing dogfood) runs
  identically — same artifacts, same git side-effects.
- New test: workflow with `isolation: none` runs in CWD without touching
  git.
- `grep -rn "worktree\|git " engine.ts dag.ts agent.ts loop.ts hitl.ts
  state.ts config.ts validate.ts` — zero matches outside the provider
  modules.
