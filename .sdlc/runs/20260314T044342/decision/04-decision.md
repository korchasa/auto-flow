---
variant: "Variant A: Verify-and-Close (mark acceptance criteria done)"
tasks:
  - desc: "Verify all tests pass via deno task check"
    files: []
  - desc: "Mark FR-40 acceptance criteria [x] with file:line evidence"
    files: ["documents/requirements.md"]
---

## Justification

**Selected Variant A** over B and C for the following reasons:

1. **Implementation already complete.** Commits `ab9fd42` (decision) and
   `7192f56` (implementation) delivered full FR-40 functionality:
   `renderCard()` accepts `streamLogHref?`, renders `<a class="log-link">`,
   `escHtml()` applied, CSS `.log-link` class defined, CLI entry scans
   `stream.log` via `Deno.stat()`, phase-aware relative href map built.

2. **Tests already cover all acceptance criteria.** Unit tests at
   `scripts/generate-dashboard_test.ts:641-678` verify: link present, link
   absent, link threading in `renderHtml`. SDS section 3.10 documents the flow.

3. **Variant B rejected:** Edge-case tests (XSS in nodeId, orphan entries,
   zero-length files) address scenarios unreachable in practice — nodeIds are
   controlled strings from pipeline config, not user input. Over-testing
   violates AGENTS.md test rule: "Test LOGIC/BEHAVIOR only."

4. **Variant C rejected:** Artifact link unification is scope creep beyond
   issue #49. Changing `renderCard` signature/HTML structure risks breaking
   consumers. Contradicts AGENTS.md vision of autonomous efficiency — no value
   in refactoring working code.

5. **Vision alignment (AGENTS.md):** "Fully autonomous, no human gates between
   stages." Variant A closes the issue with minimal pipeline cost, keeping the
   autonomous cycle efficient. The only remaining gap is SRS bookkeeping
   (`[ ]` → `[x]` with evidence).

## Task Descriptions

### Task 1: Verify all tests pass

Run `deno task check` to confirm no regressions from prior implementation.
This is a verification-only step — no file modifications.

### Task 2: Mark FR-40 acceptance criteria with evidence

Update `documents/requirements.md` section 3.38 (FR-40). Change each `[ ]` to
`[x]` with `file:line` evidence per CLAUDE.md documentation rules. Evidence
sources:

- `renderCard()` stream log check: `scripts/generate-dashboard.ts:47-98`
- CSS `.log-link` class: `scripts/generate-dashboard.ts:380`
- `escHtml()` on href: `scripts/generate-dashboard.ts:83`
- Absent-file guard: conditional render only when `streamLogHref` provided
- Unit tests: `scripts/generate-dashboard_test.ts:641-678`
- `deno task check`: verified in Task 1
