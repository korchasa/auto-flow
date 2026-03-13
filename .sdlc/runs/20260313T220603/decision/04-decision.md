---
variant: "Variant A: Test-only completion (mark existing work done)"
tasks:
  - desc: "Add empty-result unit test for renderCard()"
    files: ["scripts/generate-dashboard_test.ts"]
  - desc: "Mark FR-35 acceptance criteria [x] with file:line evidence"
    files: ["documents/requirements.md"]
---

## Justification

**Variant A selected** because the implementation already exists. Code inspection
(architect's plan) confirms `scripts/generate-dashboard.ts` lines 71-78 implement
`<details>/<summary>`, CSS uses `pre-wrap` (no `nowrap`/`ellipsis`), and `escHtml()`
covers all result content. SDS §3.10 already documents this design.

**Why not B:** Extracting a `renderResult()` helper for a 7-line block is
over-engineering with no behavioral change — contradicts AGENTS.md "avoid
over-engineering" and project principle of minimal, focused changes.

**Why not C:** Deviates from spec (which mandates `<details>/<summary>`), adds
CSS-only toggle hacks with browser quirks, and constitutes scope creep beyond
issue #47 boundaries.

**Vision alignment (AGENTS.md):** The project aims for fully autonomous pipeline
with no human gates. Variant A completes the formal closure loop (test + evidence)
without unnecessary code churn, keeping the pipeline in working condition per
project rules. The "fail fast, fail clearly" principle is preserved — no new
abstractions or workarounds introduced.

## Task Descriptions

### Task 1: Add empty-result unit test for renderCard()

Add a test case in `scripts/generate-dashboard_test.ts` that verifies
`renderCard()` handles empty/undefined result gracefully (AC #5). Test should
assert no `<details>` wrapper is rendered and no crash occurs. Run `deno task check`
to confirm pass.

### Task 2: Mark FR-35 acceptance criteria [x] with evidence

In `documents/requirements.md` §3.34 FR-35, mark all 6 acceptance criteria `[x]`
with `file:line` evidence pointing to existing implementation:
- AC #1: `scripts/generate-dashboard.ts:71-78` (`<details>/<summary>`)
- AC #2: single-line `<p>` rendering
- AC #3: CSS rules (no truncation)
- AC #4: `escHtml()` usage
- AC #5: unit test file path (after Task 1)
- AC #6: `deno task check` pass confirmation
