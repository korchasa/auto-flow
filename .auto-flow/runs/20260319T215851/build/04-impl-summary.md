## Summary

### Files Changed

- `.auto-flow/scripts/run-dashboard.sh` — New wrapper script (iter 1). Runs
  `deno task dashboard --run-dir "$1"`, captures exit code; emits
  `[WARN] dashboard generation failed (exit $code)` to stderr on failure;
  always exits 0 so calling node remains "completed" (FR-S36).
- `.auto-flow/pipeline.yaml` — Replaced `after:` value in `tech-lead-review`
  node from `deno task dashboard --run-dir {{run_dir}} || true` to
  `.auto-flow/scripts/run-dashboard.sh {{run_dir}}` (iter 1).
- `documents/requirements-sdlc.md` — Added §3.36 FR-S36 (After-Script Failure
  Observability): description, 7 acceptance criteria with evidence, and FR-S36
  row in Appendix C cross-reference table (iter 2 QA fix).

### Tests Added or Modified

None — implementation is a shell script, config edit, and SRS doc update.
Existing 528 tests serve as regression gate.

### Check Status

PASS — `deno task check`: 528 tests passed, 0 failed; pipeline config valid;
all checks passed (iter 2, run `20260319T215851`).

### Iteration 2 Fix

QA blocked on FR-S36 absent from `documents/requirements-sdlc.md`. PM agent
did not persist the SRS section (same pattern as issues #147–#153). Section
3.36 added with acceptance criteria and Appendix C row.
