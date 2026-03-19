# Agent QA — Run History

<!-- Append-only. ≤20 entries. Format per reflection-protocol.md §Layer 2. -->

## 2026-03-15T22:XX — Issue #129

- **Turns:** ~10
- **Cost:** ~$0.30 (est)
- **Verdict:** PASS
- **Outcome:** All 6 acceptance criteria passed. 483 tests, 0 failures. SKILL.md granted `scripts/check.ts` permission + FR-S31 responsibility item. SDS §3.4 updated.
- **Key learnings:**
  - `deno task check` output nested into temp file → nested again on read → use `tail -80` on first temp file to get final summary.
  - Self-approval fails → use `gh issue comment` fallback immediately.
  - Memory + history files empty on first session — normal.

## 2026-03-19T19:XX — Issue #147 (iteration 1)

- **Turns:** ~11
- **Cost:** ~$0.25 (est)
- **Verdict:** FAIL
- **Outcome:** 10/12 acceptance criteria passed. 493 tests, 0 failures. All artifact file renames correct (zero grep matches for old names). Blocking issue: FR-S32 section absent from `documents/requirements-sdlc.md` (spec says PM added it; developer's Task 3 rewrite dropped it). Self-approval failed → used `gh issue comment` fallback.
- **Key learnings:**
  - When spec's "SRS Changes" says a new FR section was added, verify it exists even if `deno task check` is green — a full-file rewrite by developer silently drops PM additions.
  - `documents/requirements-sdlc.md` too large for inline display; use `tail + Grep` pattern.
  - Grep-sweeping for old artifact names is fast and conclusive — do it early.

## 2026-03-19T18:XX — Issue #146

- **Turns:** ~8
- **Cost:** ~$0.20 (est)
- **Verdict:** PASS
- **Outcome:** All 16 acceptance criteria passed. 493 tests, 0 failures. FR-E33 composite `artifact` validation rule fully implemented in engine/types.ts, engine/config.ts, engine/validate.ts with complete test coverage.
- **Key learnings:**
  - Fetching issue, running `deno task check`, and `git diff` all in one parallel turn reduces total turns significantly.
  - Reading all 5 changed source files in one parallel response is efficient.
  - Minor non-blocking doc inaccuracy (stale count in module docstring) does not block PASS verdict.
  - Self-approval fails → used `gh issue comment` on issue #146 as fallback.

## 2026-03-19T20:XX — Issue #147 (iteration 2)

- **Turns:** ~9
- **Cost:** ~$0.20 (est)
- **Verdict:** PASS
- **Outcome:** All 12 acceptance criteria passed. 493 tests, 0 failures. FR-S32 restored to `documents/requirements-sdlc.md` (section 3.32 + Appendix C). All artifact renames complete, zero stray old-name refs. Self-approval failed → used `gh issue comment` fallback.
- **Key learnings:**
  - On fix iterations, use targeted Grep (e.g., `grep -n "FR-S32" file`) early to confirm the blocking issue is resolved before reading large files.
  - Old artifact names appearing in FR-S32 "Motivation" section are intentional historical context — NOT a problem; distinguish from active references.
  - Running `deno task check`, `git diff`, and `gh issue view` in first parallel turn + Grep for old names and FR-S32 in second turn gives full picture in ~4 turns.
