## Summary

### Files Changed

- **`scripts/generate-dashboard.ts`** — 5 new/updated features:
  1. `readStreamLog(path, maxHead=200, maxTail=50)` — new exported function; reads stream.log with head+tail truncation, returns empty string when file absent.
  2. `renderCard()` — added optional `logContent?: string` parameter; when non-empty renders `<details><summary>stream log</summary><pre class="log-content">…</pre></details>` inline after href link.
  3. CSS — split `strong.completed,strong.running` into 4 distinct rules: completed=green, running=blue (#2563eb), failed=red, aborted=orange. Added `.log-content` and `.phase-badge*` styles.
  4. `computePhaseStatus(nodeIds, nodeStates, alwaysNodes)` — new exported function; separates core nodes from `run_on:always` nodes and returns `{coreStatus, alwaysStatus?}`.
  5. `renderHtml()` — added `streamLogContents?` and `alwaysNodes?` params; passes log content to `renderCard()`; renders per-phase status badges using `computePhaseStatus()`.
  6. CLI entry — replaced `Deno.stat()` existence check with `readStreamLog()` for each node; extracts `run_on: always` from pipeline config into `Set<string>`.

### Tests Added

- **`scripts/generate-dashboard_test.ts`** — 16 new tests:
  - `readStreamLog` (×4): full content under limit, truncation with marker, empty file, missing file.
  - `renderCard` logContent (×3): renders `<details>` with log content, omits when absent, HTML-escapes content.
  - `renderHtml` CSS/status (×4): correct `<strong class="…">` for completed/running, CSS contains all 4 distinct rules, no combined `completed,running` rule.
  - `renderHtml` phase badge (×1): `phase-badge` class present when phases provided.
  - `computePhaseStatus` (×5): all-pass core + failed always, failed core + passed always, mixed running, no always-nodes, all-always-nodes edge case.

### Check Status

PASS — 509 tests, 0 failed.

---

## Iteration 2 (QA fix)

**Root cause:** PM agent wrote FR-S34 to spec artifact (`01-spec.md`) but never
persisted changes to `documents/requirements-sdlc.md` — same pattern as issues
#147 iter2 and #148 iter2.

### Files Changed (iter 2)

- `documents/requirements-sdlc.md` — added §3.34 FR-S34 Dashboard Diagnostic
  Enhancements (3 AC groups: inline log viewer, header status styling, phase
  aggregate status); replaced duplicate stale FR-S32 row in Appendix C with
  FR-S34 row.

### Tests Added or Modified (iter 2)

None — SRS documentation fix only; all implementation tests from iter 1 (509)
continue to pass.

### Check Status (iter 2)

PASS — 509 tests, 0 failed.
