---
variant: "Variant A: Evidence-Only (Mark Existing Implementation)"
tasks:
  - desc: "Mark FR-S24 acceptance criteria with evidence in SRS"
    files: ["documents/requirements-sdlc.md"]
  - desc: "Update FR-S11 evidence in SRS for phase-aware artifact paths"
    files: ["documents/requirements-sdlc.md"]
  - desc: "Run deno task check to verify no regressions"
    files: []
---

## Justification

I selected Variant A because the Architect's critical finding is correct:
`pipelineIntegrity()` in `scripts/check.ts:84-96` already calls `loadConfig()`
from `engine/config.ts`, which performs comprehensive schema validation covering
all items in FR-S24's acceptance criteria — node types, required fields, `inputs`
references, `run_on` values.

Technical fit: No new code is needed. The existing validation flow
(`pipelineIntegrity()` → `loadConfig()` → `validateSchema()` → `validateNode()`)
already satisfies the FR. Adding SDLC-specific convention checks (Variant B)
would create coupling between `scripts/check.ts` and pipeline conventions that
may change, without being required by the AC. Variant C's dedicated module and
`deno task check:pipeline` command were explicitly deferred by the PM spec as
"not specification."

Vision alignment (AGENTS.md): The project vision states the engine is
domain-agnostic and pipeline-independent. Variant A respects this boundary by
documenting the existing engine-level validation rather than adding SDLC-specific
checks that blur the scope separation. AGENTS.md also mandates "avoid
over-engineering" — Variant A is the minimum needed for the current task.

Complexity: Size S. Documentation-only changes to SRS evidence markers and SDS
component description. Zero risk of regression.

## Task Descriptions

### Task 1: Mark FR-S24 acceptance criteria with evidence in SRS

Mark all FR-S24 acceptance criteria as `[x]` in `documents/requirements-sdlc.md`
with evidence pointing to:
- `scripts/check.ts:84-96` — `pipelineIntegrity()` calls `loadConfig()`
- `engine/config.ts:43-103` — schema validation
- `engine/config.ts:105-249` — node validation (types, inputs, run_on)

### Task 2: Update FR-S11 evidence in SRS for phase-aware artifact paths

Mark FR-S11 data-flow description as updated with evidence. PM already changed
the SRS text to reflect phase-aware layout
`.sdlc/runs/<run-id>/[<phase>/]<node-id>/`. Add evidence for existing path
documentation.

### Task 3: Run deno task check to verify no regressions

Execute `deno task check` to confirm no validation errors or test failures after
documentation changes.

## Summary

I selected Variant A (Evidence-Only) because existing `loadConfig()` already
satisfies all FR-S24 acceptance criteria — no new code needed. I defined 3
tasks: mark FR-S24 evidence in SRS, update FR-S11 evidence, and run regression
check. I created branch `sdlc/issue-96` and opened a draft PR.
