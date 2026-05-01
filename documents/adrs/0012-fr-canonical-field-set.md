# ADR-0012: FR canonical field set

## Status

Accepted

## Context

After the ADR-0011 sweep collapsed test-locked acceptance items, a
second source of bloat became visible: the bold-prefixed fields
above each FR's acceptance block diverge wildly across the SRS.

Field-frequency audit (2026-05-01) across
`documents/requirements-engine/*.md` and
`documents/requirements-sdlc/*.md`:

- **Common (≥30 occurrences):** `Description`, `Acceptance criteria`,
  `Motivation`, `Tests:`.
- **Regular (5–15):** `ADR`, `Status`, `Rationale`, `Dep`,
  `Constraints`, `Quality metrics`, `Scope`, `Input`/`Output`,
  `Source`, `Supersedes`, `Acceptance` (typo synonym of
  `Acceptance criteria`).
- **One-off noise (1–3):** `Engine behavior`, `Config schema`,
  `Variables`, `Rules`, `Trigger conditions`, `Risks`, `Rollback`,
  `ROI analysis`, `Retry logic`, `Testing strategy`, plus ~25 other
  ad-hoc labels coined per FR.

The variation has three real costs:

- **Synonym drift.** `Motivation` vs `Rationale`, `Acceptance` vs
  `Acceptance criteria` carry identical meaning. Readers parse two
  shapes for one role.
- **Unbounded shape.** Each FR can invent a new bolded label
  (`Engine behavior`, `Config schema`, `Variables`, …) for what is
  really a Description subsection. There is no reviewable contract
  on "what fields an FR must have".
- **Audit cost.** No lint rejects a stray field name, so format
  drift compounds silently across PR reviews.

## Decision

Adopt one canonical field set for every FR in
`documents/requirements-{engine,sdlc}/*.md`. No other bold-prefixed
fields are allowed at the top level of an FR; FR-specific structure
is folded into prose under `Description` (with sub-headings or
nested lists as needed).

**Mandatory fields (in this order):**

1. `Description` — what the requirement is, in active voice. Inline
   any FR-specific structure (config schema, engine behaviour,
   variables, rules, trigger conditions, …) as labelled prose
   subsections under this single field.
2. `Acceptance criteria` — checkable conditions. Test-locked
   behaviour collapses to a `**Tests:**` line per
   [ADR-0011](0011-dod-test-coverage-convention.md). Manual-evidence
   items stay as `[x]` bullets with `Evidence: <path>:<line>`.

**Optional fields (in this order, only when present):**

3. `Status` — only when the FR is `Superseded by FR-X<N>` or
   otherwise non-active. Active FRs MUST NOT carry a `Status` field;
   the absence implies "in force".
4. `Motivation` — the problem/incident/force this FR addresses. Any
   FR previously using `Rationale` is migrated to `Motivation`
   verbatim; `Rationale` is no longer accepted.
5. `ADR` — one or more cross-links to relevant ADR-NNNN records
   (e.g. `ADR: ADR-0003 (per-run worktree co-location)`).
6. `Dep` — comma-separated FR-E<N>/FR-S<N> ids this FR depends on.
7. `Supersedes` — comma-separated predecessor FR ids this FR
   replaces.
8. `Input` / `Output` — workflow-stage FRs only (FR-S2..S9 and
   peers): the artefact contract for the agent driving that stage.
   Engine-feature FRs MUST NOT use these.

**Removed fields:**

- `Rationale` → migrate to `Motivation`.
- `Acceptance` → rename to `Acceptance criteria`.
- `Quality metrics` → drop. Observability targets belong in NFR or
  SDS §3 component descriptions, not in per-FR acceptance.
- All one-off fields (`Engine behavior`, `Config schema`,
  `Variables`, `Rules`, `Constraints`, `Trigger conditions`,
  `Trigger mechanism`, `Target workflow flow`, `Role changes`,
  `Git workflow changes`, `File changes`, `Invariants (no changes)`,
  `Branch lifecycle`, `Branch naming`, `Decision document format`,
  `QA report format`, `Memory content`, `Lifecycle per agent run`,
  `Storage`, `Layout`, `Migration actions`, `Engine semantics`,
  `Backward compatibility`, `Risks`, `Rollback`, `ROI analysis`,
  `Retry logic`, `Testing strategy`, `Sketch`, `Open questions`,
  `Source`, `Out of scope`, …) → fold into `Description` as labelled
  prose subsections (`### <Topic>` or bold-leader paragraphs). The
  information is preserved; the bolded top-level shape is dropped.

## Consequences

- **Positive.** Every FR has one of two shapes
  (engine-feature: 2 mandatory + up to 5 optional fields;
  workflow-stage: same + `Input`/`Output`). Synonym drift gone.
  Readers and lint can both rely on the contract.
- **Negative.** Migrating ~110 existing FRs is one large sweep.
  Some prose previously elevated to a top-level field now sits as
  a labelled paragraph under `Description` — slightly less scan-
  friendly until readers adapt. Loss is mitigated by keeping
  sub-headings inside `Description` for the larger FRs.
- **Invariants.** New FRs MUST use only the allowlisted field
  names, in the canonical order. `validateFrFields` in
  `scripts/check.ts` is the lint gate; CI rejects unknown bolded
  field labels. Active FRs MUST NOT carry `Status`.
- **Cross-link.** Codified in
  [`documents/CLAUDE.md`](../CLAUDE.md) §SRS Format and enforced by
  `scripts/check.ts::validateFrFields` (called from `frFieldSet()`
  in the main check pipeline).

## Alternatives Considered

- **Two separate templates (engine-feature vs workflow-stage).**
  Rejected — single allowlist with `Input`/`Output` flagged
  optional captures the same split with one shape, one lint, one
  spec. Avoids the `which template?` decision at FR creation time.
- **Allowlist without ordering.** Rejected — fixed order is what
  makes scanning fast (`Status` always before `Motivation`,
  `Tests:` always at the top of `Acceptance criteria`). Cost of
  one extra lint rule (`fieldsAreInCanonicalOrder`) is small.
- **Keep `Quality metrics` as optional.** Rejected — observability
  targets are SDS-level concerns or NFR §4, not per-FR acceptance.
  The 5 FRs currently using it (`FR-S2`/`S3`/`S5`/`S7`/`FR-E1`) had
  their content folded into Description prose during sweep; no
  data lost.
- **Auto-derive the Description sub-structure from sidecar YAML.**
  Rejected — adds toolchain overhead. Markdown sub-headings are
  enough.
