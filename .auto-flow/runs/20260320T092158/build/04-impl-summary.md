## Summary

### Files Changed

- `.auto-flow/pipeline.yaml` — replaced `file_exists` + `file_not_empty` +
  `contains_section` rule groups with a single `type: artifact` rule per node
  for all 6 agent nodes (specification, design, decision, build, verify,
  tech-lead-review). Unchanged rules (2× `frontmatter_field` in specification,
  `frontmatter_field: verdict` in verify, `custom_script` in build) preserved.
  Net: 19 rules removed, 6 artifact rules added (12 insertions, 40 deletions).

### Tests Added or Modified

None. This is a config-only change with no TypeScript logic. The pipeline
integrity check in `deno task check` (`loadConfig()`) is the acceptance gate
(validates `artifact` rule structure: non-empty `sections` array of strings).

### Iteration 2 Fix

- `documents/requirements-sdlc.md` — added §3.42 FR-S42 with description,
  deps, 8 acceptance criteria (all `[x]` with evidence); added FR-S42 row to
  Appendix C cross-reference table. (QA fix: PM persistence failure #16.)

### deno task check

PASS — 533 tests passed, pipeline config valid, all checks passed.
