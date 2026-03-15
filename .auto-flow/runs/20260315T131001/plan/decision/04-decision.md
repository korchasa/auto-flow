---
variant: "Variant B: Add AGENTS.md validation to deno task check"
tasks:
  - desc: "Add agentListAccuracy() function to scripts/check.ts"
    files: ["scripts/check.ts"]
  - desc: "Add unit tests for agentListAccuracy() in scripts/check_test.ts"
    files: ["scripts/check_test.ts"]
  - desc: "Wire agentListAccuracy() into main check pipeline"
    files: ["scripts/check.ts"]
  - desc: "Mark FR-S29 ACs as complete with evidence in SRS"
    files: ["documents/requirements-sdlc.md"]
---

## Justification

I selected Variant B because it directly prevents the class of regression that
caused issue #86 — a deprecated agent name appearing in `AGENTS.md` without any
automated guard catching it. The project vision (AGENTS.md) emphasizes
dogfooding: the SDLC pipeline develops itself. Adding `agentListAccuracy()` to
`deno task check` makes AC #3 ("deno task check passes") meaningful rather than
vacuously true. This aligns with the "fail fast, fail clearly" strategy from
CLAUDE.md and the existing pattern in §3.8 (FR-S24) where `pipelineIntegrity()`
validates pipeline config via the same check pipeline.

Variant A (evidence-only) would satisfy the ACs today but leave FR-S29
unprotected against future regressions. The ~30 LOC cost of Variant B is
trivial compared to the regression risk.

## Task Descriptions

### Task 1: Add `agentListAccuracy()` function to `scripts/check.ts`

I implement a function that reads `AGENTS.md`, verifies all 7 expected agent
names (PM, Architect, Tech Lead, Developer, QA, Tech Lead Review, Meta-Agent)
appear in the Project Vision section, and verifies no deprecated names
(Presenter, Reviewer, SDS Update) appear as active agents. Returns pass/fail
with descriptive error messages.

### Task 2: Add unit tests for `agentListAccuracy()`

I write tests in `scripts/check_test.ts` covering: valid 7-agent list passes,
missing agent fails, deprecated agent name present fails, extra agent fails.
Tests use real file reads where possible (TDD: RED → GREEN).

### Task 3: Wire into main check pipeline

I add `agentListAccuracy()` call to the main check sequence in
`scripts/check.ts`, alongside existing checks like `pipelineIntegrity()` and
gitleaks.

### Task 4: Mark FR-S29 ACs in SRS

I mark all 3 acceptance criteria `[x]` with evidence pointing to
`scripts/check.ts` (function + line numbers) and `AGENTS.md` current state.

## Summary

- I selected Variant B (add `agentListAccuracy()` to `deno task check`) for its
  automated regression protection, aligned with the project's dogfooding vision
  and "fail fast" strategy.
- I defined 4 tasks: implement validation function, add tests, wire into check
  pipeline, mark SRS evidence.
- I created branch `sdlc/issue-86` and will open a draft PR.
