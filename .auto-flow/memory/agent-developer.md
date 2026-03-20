---
name: agent-developer
description: Reflection memory for developer agent — anti-patterns, strategies, environment quirks
type: feedback
---

# Reflection Memory — agent-developer

## Anti-patterns

- **`assertRejects` not in vendor assert.ts**: only `assertEquals` and `assertThrows` exported. Use try/catch + assertEquals for async throw tests.
- **New ErrorCategory values need types.ts update**: custom category strings not in the type → either add to types.ts or omit `error_category` in the LoopResult return.
- **HEAD version of out-of-scope file can have pre-existing fmt issue**: `git stash push -- <file>` only works for local verification but NOT for engine's `deno task check` continuation — engine runs check on actual working tree. Must fix pre-existing fmt issues directly and commit them. Markdown table column alignment (trailing whitespace padding) is a common offender.
- **`deno-lint-ignore` inside for-loop header is not recognized**: placing `// deno-lint-ignore no-explicit-any` before `const [k, v] of Object.entries(x as Record<string, any>)` inside a for-loop header fails with `ban-unused-ignore`. Extract the cast to a separate variable on the line directly after the ignore comment instead.

- Writing complete files (Write) for simple section inserts when Edit would work
- Not checking deno fmt compliance before writing — blank lines between headings and list items required
- Splitting import updates and test additions into separate Edit calls (one Write/Edit per file rule)
- NOT committing immediately after deno task check passes — background self_runner resets to main
- Writing indentation incorrectly in multi-line function call args (matching the wrong reference level)
- Placing import statements at the bottom of a file (TS requires all imports at top)
- Leaving extra trailing blank line at end of file — deno fmt expects exactly one trailing newline
- **Edit tool says "File has not been read yet"** even when file was Read in an earlier response batch —
  must re-Read (even with offset/limit trick) to satisfy the Edit tool's session tracking

## Effective Strategies

- ONE Edit for single-location changes; ONE Write for multi-location changes (whole file rewrite)
- All parallel Reads + git log in first turn = minimal turns
- Pre-flight git log check prevents wasted work on pre-committed tasks
- COMMIT IMMEDIATELY after writing code — then run deno task check; self_runner can reset during check
- When a pre-existing fmt failure blocks check (out-of-scope file): `git stash push -- <file>`, run check,
  `git stash pop`. Confirms own code is correct without losing another agent's uncommitted work.
- For nested multi-arg calls, count indentation level carefully
- For extraction refactors (no behavioral change): existing tests are the acceptance gate — no new tests needed
- When removing imports: trace each symbol to confirm it is truly unused after extraction before deleting
- **Self-referential safety for prompt deletions:** Don't delete `.auto-flow/agents/agent-*/SKILL.md` files
  during a pipeline run — the engine may still need them for later nodes in the current run

## Environment Quirks

- `deno fmt` checks ALL `.md` files in the repo, not just TypeScript
- Memory files require blank lines between `##` headings and first list item (deno fmt rule)
- deno task check output >50KB persisted to temp file — no `<error>` wrapper = PASS; check tail for "All checks passed!"
- **CRITICAL**: `scripts/self_runner.ts` runs as background process. When `.auto-flow/lock.json` is absent,
  self_runner starts a new pipeline run → calls `.auto-flow/scripts/reset-to-main.sh` →
  `git checkout -f main && git reset --hard origin/main && git clean -fd`. DESTROYS all uncommitted changes.
- TypeScript `.some((e) => ...)` callbacks need explicit `: string` type annotation to avoid TS7006
- "File has been modified since read" appears due to background resets — always re-read before writing
- **Pre-existing dirty files from other agents can fail deno fmt check**: use `git stash push -- <file>`
  to temporarily clear them, verify own code passes, then `git stash pop` to restore
- **Edit tool session tracking**: Re-read files with offset/limit (small range) to satisfy "File has not
  been read yet" errors — happens when file was Read in a previous parallel batch

## Self-Referential SKILL.md Deletions

- When the task is pure markdown deletion from SKILL.md files (no TS logic), no tests are needed per "DO NOT test constants/templates".
- All 6 edits can be issued in parallel in one turn for maximum efficiency.

## Doc-Only Run Pattern

- When all 4 tasks are documentation-only (no TS logic), no tests needed.
- Large markdown files (>89KB) can't be Read in full — use targeted Grep + Read
  by offset/limit to locate specific sections, then issue multiple Edit calls.
- Multiple parallel Edit calls on same large file is efficient and reliable when
  each old_string is unique (avoids full-file Write which requires full read).
- design-sdlc.md may already be updated by Tech Lead in the decide phase — check §8
  for existing FR-S<N> entry before writing.

## Scope-Check Module Pattern (FR-E37)

- `scope_check` is an internal-only `ValidationRule.type` — added to the union but never user-configured in YAML.
- Synthetic `ValidationResult` uses `path: ""` (empty string) since scope_check has no file path concept.
- While loop condition must be widened: `validationRules.length > 0 || node.allowed_paths !== undefined` — otherwise loop skips when no validate rules but scope check is active.
- `allPassed([])` returns `true` (Array.every on empty), so loop exits correctly when no rules and no scope violations.
- `beforeSnapshot` updated to `afterSnapshot` after each iteration — incremental detection, not cumulative.
- `globMatch()` implemented inline: `**` → `.*`, `*` → `[^/]*`, `?` → `[^/]`, literals escaped.

- **FR-E36 appendix gap**: When adding FR-E37 appendix row, also check that FR-E36 is in
  the appendix — it was missing (section existed in main but row was never added). Safe to
  fix both in the same QA-fix commit.

## Hook Template Validation Pattern (FR-E7)

- `validateTemplateVars()` is the pure validation twin of `resolve()` in template.ts — same prefix/key logic, no I/O, accumulates errors.
- Hook validation in `validateNode()` placed after type-specific checks (agent/loop/human), before `run_on` validation.
- Loop body nodes automatically get the combined `[...allNodeIds, ...bodyNodeIds]` context via the existing `validInputIds` already passed to recursive `validateNode()` calls — no special-casing needed.
- `env.*` and `args.*` are always accepted in validateTemplateVars (any suffix valid, resolved at runtime).

## Baseline Metrics

- Run 20260315T003418: ~14 turns, scope sdlc, issue #121 (FR-S29), 7 SKILL.md + 2 memory files — PASS
- Run 20260315T131001: ~38 turns, scope sdlc, issue #86 (FR-S29 impl), 3 files changed — PASS but env resets
- Run 20260315T161245: ~15 turns, scope engine, issue #91 (FR-E30), 2 files changed — PASS (stash workaround)
- Run 20260315T165136: ~12 turns, scope engine, issue #92 (FR-E30), 2 files changed — PASS (stash + trailing newline fix)
- Run 20260315T205730: ~18 turns, scope sdlc, issue #127, 12 files changed — PASS (stash pattern; Edit re-read pattern)
- Run 20260315T213641: ~10 turns, scope engine, issue #128 (FR-E32), 4 files changed — PASS (stash pattern; HEAD fmt issue needed direct fix)
- Run 20260315T215901: ~12 turns, scope sdlc, issue #129 (FR-S31), 3 files changed — PASS (Write full file; SDS already had content; pre-existing fmt in other agents' files needed direct fix, stash insufficient for engine check)
- Run 20260319T180115: ~9 turns, scope engine, issue #146 (FR-E33), 5 files changed — PASS (pre-existing fmt in committed tech-lead-history.md needed direct Write fix; stash not applicable for committed files)
- Run 20260319T182156 iter1: ~15 turns, scope sdlc, issue #147 (FR-S32), 9 files changed — PASS (pure rename; SDS already updated by tech-lead; deno fmt table alignment painful for wide markdown columns — binary-search col widths)
- Run 20260319T182156 iter2: ~5 turns, scope sdlc, issue #147 (FR-S32) QA fix — PASS (PM's FR-S32 SRS addition dropped in iter 1; added section 3.32 + Appendix C row)
- Run 20260319T192055 iter1: ~5 turns, scope sdlc, issue #148 (FR-S33), 7 files changed — PASS (delete-only + block removal; SDS already correct from tech-lead; SRS NOT updated → QA FAIL)
- Run 20260319T192055 iter2: ~8 turns, scope sdlc, issue #148 (FR-S33) QA fix — PASS (SRS: added §3.33, NFR §4, Appendix B/C, stale FR-S13/FR-S15 ACs; same pattern as iter2 of issue #147)
- Run 20260319T194808: ~7 turns, scope sdlc, issue #149 (FR-S34), 2 files changed — PASS (Write both files; deno-lint-ignore inside for-loop header not recognized → extract cast to separate variable before loop)
- Run 20260319T194808 iter2: ~5 turns, scope sdlc, issue #149 (FR-S34) QA fix — PASS (SRS: added §3.34, Appendix C FR-S34 row; same PM persistence failure pattern as #147/#148)
- Run 20260319T201620: ~10 turns, scope engine, issue #150 (FR-E33), 5 files changed — PASS (mutual-exclusivity validation; pipeline.yaml used both mechanisms → necessary fix outside tasks[].files; task breakdown should always include all affected files)
- Run 20260319T201620 iter2: ~5 turns, scope engine, issue #150 QA fix — PASS (SRS: added §3.33, updated FR-E9 criterion, Appendix row; fourth consecutive PM persistence failure across #147/#148/#149/#150)
- Run 20260319T204544: ~8 turns, scope sdlc, issue #151 (FR-S35), 5 files changed — PASS (template interpolation in buildScriptArgs + SDLC-level validation in check.ts; pure validator function pattern same as validateAgentListContent)
- Run 20260319T204544 iter2: ~5 turns, scope sdlc, issue #151 (FR-S35) QA fix — PASS (SRS: added §3.35, Appendix C row; fifth consecutive PM persistence failure #147/#148/#149/#150/#151)
- Run 20260319T211036: ~10 turns, scope engine, issue #152 (FR-E34), 3 files changed — PASS (info log + 5 interaction tests; SDS pre-populated by Tech Lead; `async` lambdas without await → `require-await` lint error → use `Promise.resolve(true)`)
- Run 20260319T213344: ~7 turns, scope engine, issue #153 (FR-E35), 4 files changed — PASS (forwarding validation in config.ts; SDS already pre-populated by Tech Lead; pipeline.yaml gap caught by new check → fix loop inputs; same coexistence pattern as #150)
- Run 20260319T213344 iter2: ~5 turns, scope engine, issue #153 (FR-E35) QA fix — PASS (SRS: added §3.35 + Appendix row; sixth consecutive PM persistence failure #147–#153)
- Run 20260319T215851: ~5 turns, scope sdlc, issue #154 (FR-S36), 2 files changed — PASS (shell wrapper + pipeline.yaml edit; no TS logic → no new tests; do NOT use set -euo pipefail in wrapper — must capture non-zero exit code)
- Run 20260319T215851 iter2: ~4 turns, scope sdlc, issue #154 (FR-S36) QA fix — PASS (SRS: added §3.36, Appendix C row; seventh consecutive PM persistence failure #147–#154)
- Run 20260319T221833: ~8 turns, scope engine+sdlc, issue #155 (FR-E36+FR-S37), 5 files changed — PASS (parse-time cross-check in config.ts; runtime throw in loop.ts; assertRejects not in vendor assert.ts → use try/catch; "validation_failed" not in ErrorCategory → omit error_category; pipeline.yaml coexistence pattern again)
- Run 20260319T221833 iter2: ~5 turns, scope engine+sdlc, issue #155 QA fix — PASS (SRS: added §3.36 FR-E36 to requirements-engine.md + §3.37 FR-S37 to requirements-sdlc.md + both Appendix rows; ninth consecutive PM persistence failure #147–#155)
- Run 20260319T224519: ~5 turns, scope sdlc, issue #156 (FR-S38), 2 files changed — PASS (pipeline.yaml prompt→file() migration; integrity test inverted: presence→absence assertion for FR-S38 AC#3).
- Run 20260319T224519 iter2: ~4 turns, scope sdlc, issue #156 QA fix — PASS (SRS: added §3.38 + Appendix C row; tenth consecutive PM persistence failure #147–#156).
- Run 20260319T230952 iter2: ~5 turns, scope sdlc, issue #157 (FR-S39) QA fix — PASS (SRS: added §3.39 + Appendix C row; eleventh consecutive PM persistence failure #147–#157).
- Run 20260320T000829: ~5 turns, scope sdlc, issue #159 (FR-S41), 2 files changed — PASS (shell script + new bash test file; 7 shell tests all green; deno task check unaffected since no TS changes).
- Run 20260320T000829 iter2: ~4 turns, scope sdlc, issue #159 (FR-S41) QA fix — PASS (SRS: added §3.41 + Appendix C row; fourteenth consecutive PM persistence failure #147–#159).
- Run 20260320T092158: ~5 turns, scope sdlc, issue #174 (FR-S42), 1 file changed — PASS (config-only: 19 validate rules → 6 artifact rules in pipeline.yaml; pipeline integrity check is acceptance gate; no tests needed).
- Run 20260320T092158 iter2: ~4 turns, scope sdlc, issue #174 (FR-S42) QA fix — PASS (SRS: added §3.42 + Appendix C row; sixteenth consecutive PM persistence failure #147–#174).
- Run 20260320T094502 iter2: ~5 turns, scope engine, issue #175 (FR-E37) QA fix — PASS (SRS: added §3.37, updated FR-E1 §3.1 Future→[x], Appendix FR-E36+FR-E37 rows; seventeenth consecutive PM persistence failure #147–#175).
- Run 20260320T101834: ~6 turns, scope engine, issue #176 (FR-E7), 4 files changed — PASS (validateTemplateVars() in template.ts + hook validation in config.ts; 12+8 new tests; loop body nodes inherit combined IDs via existing recursive call).
- Run 20260320T101834 iter2: ~4 turns, scope engine, issue #176 (FR-E7) QA fix — PASS (SRS: replaced vague FR-E7 criterion with 4 detailed [x] criteria + evidence; nineteenth consecutive PM persistence failure #147–#176).
- Run 20260320T104440: ~6 turns, scope sdlc, issue #178 (FR-S43/44/45), 2 files changed — PASS (doc-only: Architect Codebase Exploration + QA Confidence Scoring + QA Multi-Focus Review + Agent tool allowances; 4 tasks, 2 Write calls).
- Target: ≤35 turns. Key lesson: commit before deno task check; stash pattern for pre-existing fmt issues.

## Pipeline.yaml Coexistence Pattern

- When engine validation is tightened to reject a config pattern, the reference pipeline.yaml may use that pattern and must be fixed simultaneously.
- Tech-lead task breakdown should include `pipeline.yaml` when validation changes affect it.
- Fix: remove the redundant mechanism (per-node `phase:` fields when top-level `phases:` block is authoritative).

## QA-Fix Pattern

- When QA flags a missing SRS section: read the spec (01-spec.md) for the PM's exact stated SRS changes, then reconstruct the missing section matching the project SRS format. Look at adjacent sections (e.g., 3.31) for format reference.
