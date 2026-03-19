## Summary

### Files Changed

- `engine/types.ts` — Added `"artifact"` to `ValidationRule.type` discriminated
  union; added optional `sections?: string[]` field.
- `engine/config.ts` — Added `"artifact"` to `validTypes` in
  `validateValidationRule()`; added schema checks: `sections` must be a
  non-empty array of strings when `type === "artifact"`.
- `engine/validate.ts` — Added private `checkArtifact(rule, path)` function
  (~50 lines): fail-fast (absent → empty → missing sections aggregate); wired
  `case "artifact"` into `runSingleValidation()` switch.
- `.auto-flow/memory/agent-tech-lead-history.md` — Fixed pre-existing `deno fmt`
  trailing-whitespace issue (table column alignment) that blocked `deno task
  check`.

### Tests Added / Modified

- `engine/config_test.ts` — 4 new tests:
  - artifact rule without `sections` → rejected
  - artifact rule with empty `sections` array → rejected
  - artifact rule with non-string elements in `sections` → rejected
  - valid artifact rule → accepted and parsed
- `engine/validate_test.ts` — 6 new tests:
  - file absent → single error mentioning path
  - empty file → single error mentioning "empty"
  - all sections present → pass
  - some sections missing → aggregate error listing only missing ones
  - all sections missing → aggregate error listing all
  - template path interpolation works

### `deno task check` Result

PASS — 493 passed | 0 failed
