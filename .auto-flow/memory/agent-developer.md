---
name: agent-developer
description: Reflection memory for developer agent — anti-patterns, strategies, environment quirks
type: feedback
---

# Reflection Memory — agent-developer

## Anti-patterns

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
- Target: ≤35 turns. Key lesson: commit before deno task check; stash pattern for pre-existing fmt issues.

## Pipeline.yaml Coexistence Pattern

- When engine validation is tightened to reject a config pattern, the reference pipeline.yaml may use that pattern and must be fixed simultaneously.
- Tech-lead task breakdown should include `pipeline.yaml` when validation changes affect it.
- Fix: remove the redundant mechanism (per-node `phase:` fields when top-level `phases:` block is authoritative).

## QA-Fix Pattern

- When QA flags a missing SRS section: read the spec (01-spec.md) for the PM's exact stated SRS changes, then reconstruct the missing section matching the project SRS format. Look at adjacent sections (e.g., 3.31) for format reference.
