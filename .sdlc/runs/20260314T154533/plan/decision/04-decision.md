---
variant: "Variant A: Extract with ordered-groups return type"
tasks:
  - desc: "Write unit tests for groupNodesByPhase() — 4 scenarios: phased grouping, unphased 'other' group, empty nodeIds, no phases config"
    files: ["scripts/generate-dashboard_test.ts"]
  - desc: "Implement exported groupNodesByPhase(nodeIds, phases?) returning Array<{label, ids}>"
    files: ["scripts/generate-dashboard.ts"]
  - desc: "Refactor renderHtml() to delegate phase-grouping to groupNodesByPhase(), collapsing if/else branches into single map-over-groups path"
    files: ["scripts/generate-dashboard.ts"]
  - desc: "Run full test suite + deno task check to verify no behavior change"
    files: []
---

## Justification

I selected **Variant A** over B and C for these reasons:

- **Explicit ordering:** `Array<{label, ids}>` preserves phase ordering by
  construction. Variant B's `Record<string, string[]>` relies on V8 object key
  insertion order — semantically weaker, not guaranteed by ECMAScript spec for
  all engines. Since the dashboard renders sections in order, explicit ordering
  is the correct data structure.
- **Minimal coupling:** Takes `nodeIds: string[]` + optional `phases` instead of
  full `RunState`. Callers don't need to construct a complete state object for
  grouping — aligns with AGENTS.md vision of composable, domain-agnostic
  components.
- **Natural fallback handling:** The "other" group for ungrouped nodes is just
  another array element, not a magic string key. No key collision risk.
- **SRS signature amendment:** FR-S26 specifies `Record<string, string[]>` —
  the array return type is a strict improvement (preserves all information +
  adds ordering). Minor SRS amendment, not a contradiction.
- **Variant C rejected:** Extracting `renderPhaseGroups()` is scope creep beyond
  FR-S26. Single call site, no reuse benefit. Over-engineering per AGENTS.md
  planning rules.

## Task Descriptions

### Task 1: Write unit tests for `groupNodesByPhase()`

Add test cases in `scripts/generate-dashboard_test.ts` covering 4 scenarios
(TDD RED phase):

- Phased nodes grouped correctly — nodes assigned to declared phases appear in
  corresponding groups with correct labels
- Unphased nodes placed in `"other"` group — nodes not listed in any phase
  collected into fallback group
- Empty `nodeIds` returns empty array — no groups generated for empty input
- No `phases` config — single group with all nodeIds, empty label

### Task 2: Implement `groupNodesByPhase()`

Add exported function to `scripts/generate-dashboard.ts`:

```ts
export function groupNodesByPhase(
  nodeIds: string[],
  phases?: Record<string, string[]>,
): Array<{ label: string; ids: string[] }>
```

Logic extracted verbatim from current `renderHtml()` lines 259-302: iterate
phase entries, filter to nodes present in `nodeIds`, collect ungrouped into
`"other"` group. When `phases` absent/empty, return single group with all
`nodeIds`. TDD GREEN phase.

### Task 3: Refactor `renderHtml()` to use `groupNodesByPhase()`

Replace inline phase-grouping logic in `renderHtml()` with call to
`groupNodesByPhase(Object.keys(state.nodes), phases)`. Collapse the current
if/else branch (phases vs no-phases) into a single `groups.map()` path that
generates `<section>` HTML per group. TDD REFACTOR phase — no behavior change.

### Task 4: Verify no regressions

Run `deno task check` (lint + format + test + pipeline validation). All existing
dashboard tests must pass. No new warnings or errors.

## Summary

I selected Variant A (ordered-groups array return type) for its explicit
ordering semantics, minimal coupling, and natural fallback handling. I defined
4 tasks: tests first (TDD RED), implementation (GREEN), renderHtml refactor
(REFACTOR), and full verification. I created branch `sdlc/issue-93` and will
open a draft PR with SDS updates.
