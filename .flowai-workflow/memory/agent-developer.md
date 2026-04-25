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
- NOT committing immediately after deno task check passes — background self-runner resets to main
- Writing indentation incorrectly in multi-line function call args (matching the wrong reference level)
- Placing import statements at the bottom of a file (TS requires all imports at top)
- Leaving extra trailing blank line at end of file — deno fmt expects exactly one trailing newline
- **Edit tool says "File has not been read yet"** even when file was Read in an earlier response batch —
  must re-Read (even with offset/limit trick) to satisfy the Edit tool's session tracking
- **Split edit calls for single file**: when multiple changes needed in a file, should use ONE Write. If
  accidentally split into 2 Edits (e.g. import update then append tests), it works but violates process.

## Effective Strategies

- ONE Edit for single-location changes; ONE Write for multi-location changes (whole file rewrite)
- All parallel Reads + git log in first turn = minimal turns
- Pre-flight git log check prevents wasted work on pre-committed tasks
- COMMIT IMMEDIATELY after writing code — then run deno task check; self-runner can reset during check
- When a pre-existing fmt failure blocks check (out-of-scope file): `git stash push -- <file>`, run check,
  `git stash pop`. Confirms own code is correct without losing another agent's uncommitted work.
- For nested multi-arg calls, count indentation level carefully
- For extraction refactors (no behavioral change): existing tests are the acceptance gate — no new tests needed
- When removing imports: trace each symbol to confirm it is truly unused after extraction before deleting
- **Self-referential safety for prompt deletions:** Don't delete `.claude/agents/agent-*.md` files
  during a workflow run — the engine may still need them for later nodes in the current run
- **Check JSR cached version for library fields**: sibling repo may be ahead; verify v0.5.4 cache directly
  via `deno info jsr:@korchasa/ai-ide-cli@0.5.4/runtime/types` → get local cache path → grep for field

## Environment Quirks

- `deno fmt` checks ALL `.md` files in the repo, not just TypeScript
- Memory files require blank lines between `##` headings and first list item (deno fmt rule)
- deno task check output >50KB persisted to temp file — no `<error>` wrapper = PASS; check tail for "All checks passed!"
- **CRITICAL**: `scripts/self-runner.ts` runs as background process. When `.flowai-workflow/lock.json` is absent,
  self-runner starts a new workflow run → calls `.flowai-workflow/scripts/reset-to-main.sh` →
  `git checkout -f main && git reset --hard origin/main && git clean -fd`. DESTROYS all uncommitted changes.
- TypeScript `.some((e) => ...)` callbacks need explicit `: string` type annotation to avoid TS7006
- "File has been modified since read" appears due to background resets — always re-read before writing
- **Pre-existing dirty files from other agents can fail deno fmt check**: use `git stash push -- <file>`
  to temporarily clear them, verify own code passes, then `git stash pop` to restore
- **Edit tool session tracking**: Re-read files with offset/limit (small range) to satisfy "File has not
  been read yet" errors — happens when file was Read in a previous parallel batch
- **JSR library env field**: `RuntimeInvokeOptions.env?: Record<string,string>` present in v0.5.4 — confirmed
  via deno info + grep of cached file at path from `deno info jsr:@korchasa/ai-ide-cli@0.5.4/runtime/types`

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

## Artifact Fields Pattern (FR-E38)

- `fields?: string[]` on `ValidationRule` — optional, presence-only check (not value constraint).
- `validateValidationRule()` change: old "requires non-empty sections" → new "at least one of sections/fields".
  Must update 2 existing tests that checked the old error message.
- `checkArtifact()` field check placed after sections check. Uses `^key:\s*(.*)$` regex with `m` flag;
  checks `!fieldMatch || !fieldMatch[1].trim()` to catch both absent and empty-valued fields.
- No `assertRejects` needed — all sync config tests use `assertThrows`.

## Large File Edit Tool Tracking

- When `Read` output exceeds ~85KB, the system saves it to a temp file and the Edit tool
  does NOT recognize the file as "read" (tracking fails). Re-reading with offset/limit also
  fails in this case.
- Fix: use Bash with Python inline script to apply changes to large files. This is a valid
  fallback when the dedicated Edit tool is broken due to temp-file output routing.

## Binary Distribution Pattern (FR-E39)

- `VERSION` constant uses `Deno.env.get("VERSION") ?? "dev"` — embedded at compile time via `deno compile --env-file <tmpfile>` where tmpfile contains `VERSION=<tag>`.
- `getVersionString()` exported for testability; `--version`/`-V` case in parseArgs calls it + `Deno.exit(0)` (same as `--help`).
- `scripts/compile.ts` writes a temp env file, iterates targets, runs `deno compile --allow-all --target <t> --env-file <f> --output <name> cli.ts`, removes temp file in `finally` block. (Entry was `engine/cli.ts` pre-#208; now at repo root.)
- Release workflow: `ubuntu-latest` for all 4 targets (cross-compilation handled by deno compile's built-in cross-target support); `actions/upload-artifact` per job; final job uses `actions/download-artifact` with `merge-multiple: true` then `gh release create`.
- No test needed for `--version` flag itself (calls Deno.exit; same untested pattern as `--help`). Test VERSION type + getVersionString format instead.

## CLI Version Pinning Pattern (FR-E49)

- `buildSpawnEnv(nodeEnv?)` merges nodeEnv with `{ DISABLE_AUTOUPDATER: "1" }` using spread; engine key placed last to win on conflict.
- Wire `buildSpawnEnv(node.env)` once before both `adapter.invoke()` calls in `runAgent()` — assign to `spawnEnv` const, pass as `env:` param.
- `hitl.ts` uses `buildSpawnEnv(opts.node.env)` inline in the `runtimeRun()` call.
- `loop.ts` `LoopRunOptions.env?` + `AgentRunOptions.env?`: both declared. `LoopRunOptions.env` forwarded to `runAgent({env: opts.env})`; inside `runAgent`, merged as `buildSpawnEnv({ ...(node.env ?? {}), ...(env ?? {}) })`.
- `captureClaudeVersion()` in engine.ts: tries stdout then stderr, matches `/\d+\.\d+\.\d+/`; graceful catch logs warn and returns undefined.
- Version capture placed after first `saveState()` in `runWithLock()`; second `saveState()` only when version is captured (undefined skips re-save).
- Test strategy: type-level + JSON roundtrip tests for `claude_cli_version`; no subprocess mock needed.
- **QA iter 2 lesson**: `LoopRunOptions.env` "dead field" — always check that new options are actually forwarded in the call site, not just declared in the interface.

## Baseline Metrics

- Run 20260315T003418: ~14 turns, scope sdlc, issue #121 (FR-S29) — PASS
- Run 20260320T213059: ~6 turns, scope engine, issue #182 (FR-E38) — PASS
- Run 20260320T220824: ~7 turns, scope engine, issue #183 (FR-E39) — PASS
- Run 20260320T223114: ~12 turns, scope engine, issue #183 iter2 — PASS
- Run 20260425T222337: ~10 turns, scope engine, issue #196 (FR-E49) — PASS (env field confirmed in v0.5.4; split Edit calls on agent_test.ts)
- Run 20260425T222337 iter2: ~8 turns, scope engine, issue #196 iter2 — PASS (LoopRunOptions.env forwarding fix + AgentRunOptions.env field)
- Target: ≤35 turns.
