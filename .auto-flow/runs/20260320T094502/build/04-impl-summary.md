## Summary

### Files Changed

- `engine/scope-check.ts` (new): `snapshotModifiedFiles()` runs `git diff --name-only HEAD` + `git ls-files --others --exclude-standard`; `findViolations()` pure function computes `after − before` set difference and filters against `allowedPaths` globs; internal `globMatch()` handles `**`, `*`, `?`, and literal patterns.
- `engine/types.ts`: added `allowed_paths?: string[]` to `NodeConfig`; added `"scope_check"` to `ValidationRule.type` union (internal-only, engine-injected).
- `engine/config.ts`: added `validateAllowedPaths()` function; called from `validateNode()` when `allowed_paths` present — validates array of non-empty strings at parse time.
- `engine/agent.ts`: imported `findViolations`, `snapshotModifiedFiles` from `scope-check.ts`; added `ValidationRule` to types import; in `runAgent()` — snapshot before first invocation when `node.allowed_paths` set, changed while condition to `validationRules.length > 0 || node.allowed_paths !== undefined`, inject synthetic `scope_check` `ValidationResult` on violations, update `beforeSnapshot` incrementally per iteration.
- `engine/scope-check_test.ts` (new): 12 tests for `findViolations()` (no violations, violation detected, pre-existing exclusion, empty sets, glob `*`, `**`, exact match, multiple violations) + 1 integration test for `snapshotModifiedFiles()`.
- `engine/agent_test.ts`: 4 new scope-check integration tests verifying `NodeConfig.allowed_paths` type, absence default, `ValidationRule.scope_check` type, and `ValidationResult` failure structure.

### Tests Added or Modified

- `engine/scope-check_test.ts`: 13 new tests (12 `findViolations` + 1 `snapshotModifiedFiles`)
- `engine/agent_test.ts`: 4 new tests

- `documents/requirements-engine.md` (iter 2): added §3.37 FR-E37 section (9 ACs with
  evidence), updated §3.1 FR-E1 `[ ] Future` bullet to `[x]` referencing FR-E37, added
  FR-E36 and FR-E37 rows to Appendix FR cross-reference table.

### deno task check Result

PASS — 549 tests passed, 0 failed
