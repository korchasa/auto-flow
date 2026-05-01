# Architecture Decision Records (ADRs)

> Append-only log of architectural decisions for `flowai-workflow`.
> Records the **why** behind choices that are otherwise buried in FR
> patch-logs, commit messages, and AGENTS.md prose.

## Format

[Michael Nygard's ADR format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).
Required level-2 sections, exact wording and order:

- `## Status` — `Proposed` | `Accepted` | `Superseded by ADR-NNNN`
- `## Context` — problem statement, forces, triggering incident
- `## Decision` — the position taken
- `## Consequences` — outcomes (good and bad), invariants, enforcement
- `## Alternatives Considered` — paths NOT taken, with rationale

Use [_template.md](_template.md) as the skeleton.

## Rules

- **Append-only.** Once `Accepted`, an ADR is immutable — typos and
  link rot are the only legitimate edits. Decisions evolve via NEW
  ADRs that link back via `Superseded by ADR-NNNN`.
- **Numbering.** `NNNN-kebab-title.md` from `0001`. Monotonic, no
  gaps. Enforced by `scripts/check.ts::validateAdrSet`.
- **Size budget.** One ADR per file, fits in `Read`'s 10k-token limit
  (per `documents/CLAUDE.md` budget rule).
- **Cross-references.** Cite FR-E<N> / FR-S<N> ids, file paths with
  line numbers, and ADR-NNNN back-links — same convention as SRS/SDS.
- **Promotion path.** Proposals (P1..P4 in
  [`requirements-engine/00-meta.md`](../requirements-engine/00-meta.md))
  graduate to FRs; substantive architectural decisions made along the
  way are recorded as ADRs at acceptance time.

## Index

- [ADR-0001](0001-isolation-provider.md) — Engine domain-agnostic via
  pluggable IsolationProvider — **Proposed**
- [ADR-0002](0002-hitl-detection-boundary.md) — HITL detection lives
  in `@korchasa/ai-ide-cli`, not the engine — **Proposed**
- [ADR-0003](0003-per-run-worktree-co-location.md) — Per-run worktree
  co-located under `<workflowDir>/runs/<run-id>/worktree/` (FR-E57)
  — **Accepted**
- [ADR-0004](0004-detached-head-rescue-branch.md) — Pin detached
  HEAD before worktree removal (FR-E51) — **Accepted**
- [ADR-0005](0005-cwd-relative-template-paths.md) — Cwd-relative
  TemplateContext path contract (FR-E52) — **Accepted**
- [ADR-0006](0006-per-workflow-run-lock.md) — Per-workflow-folder run
  lock at `<workflowDir>/runs/.lock` (FR-E54) — **Accepted**
- [ADR-0007](0007-phase-registry-per-run.md) — Phase registry scoped
  to each `Engine.run()` (FR-E59) — **Accepted**
- [ADR-0008](0008-signal-handler-boundary.md) — Engine never installs
  OS signal handlers; bin entry points only (FR-E61) — **Accepted**
- [ADR-0009](0009-budget-cli-runtime-coupling.md) — Budget enforcement
  is coupled to the CLI runtime (FR-E47); planned move into
  `@korchasa/ai-ide-cli` — **Accepted**
- [ADR-0010](0010-jsr-publish-caveats.md) — JSR publish surface:
  `.versionrc.json`, `publish.exclude`, `--dry-run` — **Accepted**
- [ADR-0011](0011-dod-test-coverage-convention.md) — DoD items
  covered by regression tests collapse to a `**Tests:**` pointer
  — **Accepted**

Status legend:
- **Proposed** — written, not yet implemented (back-fill anchors a
  forthcoming task; see `documents/tasks/`).
- **Accepted** — decision implemented and reflected in code.
- **Superseded by ADR-NNNN** — replaced; see the linked successor.

## Lint

`scripts/check.ts::validateAdrSet` runs as part of `deno task check`:

- Filenames match `^\d{4}-[a-z0-9-]+\.md$` (or are `README.md` /
  `_template.md`).
- Numbering is contiguous from `0001`, no gaps, no duplicates.
- Required sections present in each ADR, in the right order.
- `Status` is one of the three accepted values; `Superseded by
  ADR-NNNN` references an ADR that exists in the set.
- All `ADR-NNNN` cross-references in ADR bodies resolve to existing
  files in the directory.
