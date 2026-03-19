## Summary

### Files Changed

- `.auto-flow/pipeline.yaml` — Removed `prompt:` field from all 6 agent nodes
  (`specification`, `design`, `decision`, `build`, `verify`, `tech-lead-review`).
  Prepended `{{file(".auto-flow/agents/shared-rules.md")}}` + `---` +
  `{{file(".auto-flow/agents/agent-<name>/SKILL.md")}}` + `---` to each node's
  `task_template`, satisfying FR-S38 AC#1–3.

- `engine/pipeline_integrity_test.ts` — Updated the pipeline integrity test:
  changed assertion from "pipeline must have ≥1 prompt file" to "pipeline must
  have 0 prompt files" (FR-S38 AC#3 enforcement). Test count: 533 (was 533).

### Tests Added/Modified

- `engine/pipeline_integrity_test.ts`: test `"pipeline.yaml — no agent node
  uses prompt: field (FR-S38 AC#3)"` — behavioural inversion of prior assertion;
  now validates absence of `prompt:` fields in the reference pipeline.

### Check Status

PASS — 533 tests, 0 failed. All pipeline integrity, HITL, agent-list, and doc
lint checks passed.

---

## Iteration 2 Summary (QA Fix)

### Files Changed

- `documents/requirements-sdlc.md` — added §3.38 FR-S38 (Pipeline Agent Context
  via file() Injection in task_template) with 4 acceptance criteria (all `[x]`
  with evidence); added FR-S38 row to Appendix C cross-reference table.
  Root cause: PM-stage SRS persistence failure (recurring pattern #147–#156).

### Tests Added / Modified

- None. Documentation-only change.

### deno task check Result

PASS — 533 tests, 0 failures.
