<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — Distribution and Housekeeping


### 3.26 FR-E26: Engine Codebase Housekeeping

- **Description:** Engine source tree must remain free of dead code and stale documentation. Barrel export files with no runtime or test consumers must be removed. Pre-implementation research docs in `documents/rnd/` superseded by implemented FRs must be deleted or archived. Empty run artifact directories must not be tracked in version control.
- **Motivation:** `engine/mod.ts` is a barrel re-export not imported by runtime code or tests (only referenced as a type-check target in `deno task check`). Retaining it without a clear owner creates confusion about the engine's public API surface. `documents/rnd/human-in-the-loop.md` (18KB, Russian, 2026-03-11) predates the HITL implementation (FR-E8) and may be superseded by it. Empty `.flowai-workflow/runs/*/implementation` directories accumulate from loop iterations; `.gitignore` covers `.flowai-workflow/runs/` but stale tracked entries must be purged.
- **Acceptance criteria:**
  - [x] `engine/mod.ts` purpose documented via module-level JSDoc: barrel re-export for `deno doc --lint`. Evidence: `engine/mod.ts:1`
  - [x] `documents/rnd/human-in-the-loop.md` deleted — superseded by `engine/hitl.ts` + SDS §5 HITL documentation. Evidence: file removed from repo.
  - [x] Empty `.flowai-workflow/runs/*/implementation` directories are not git-tracked; `.gitignore` covers `runs/` directory.
  - [x] All existing engine tests pass after changes. Evidence: `deno task check` PASS



### 3.27 FR-E27: Test Suite Integrity

- **Description:** Every test function in `engine/` test files must contain ≥1 explicit assertion. Tests with no assertions pass trivially, provide zero coverage value, and mask implementation errors.
- **Motivation:** `engine/lock_test.ts:143` — test "releaseLock - no error if lock file already removed" contained no assertions, silently passing while verifying nothing.
- **Acceptance criteria:**
  - [x] Test "releaseLock - no error if lock file already removed" in
    `engine/lock_test.ts` includes
    `assertEquals(await releaseLock(lockPath), undefined)`.
  - [x] All engine tests pass after change.



### 3.28 FR-E28: Shared Backoff Utility (`nextPause()`)

- **Description:** `nextPause()` function is duplicated in `scripts/self-runner.ts` and `scripts/loop-in-claude.ts`. Extract into a shared `scripts/backoff.ts` module to eliminate duplication.
- **Motivation:** DRY violation — backoff logic changes must be applied in multiple places; shared module ensures consistency.
- **Acceptance criteria:**
  - [x] `scripts/backoff.ts` exists and exports `nextPause()`.
  - [x] `scripts/self-runner.ts` imports `nextPause` from `scripts/backoff.ts`;
    no local `nextPause` definition remains.
  - [x] `scripts/loop-in-claude.ts` imports `nextPause` from
    `scripts/backoff.ts`; no local `nextPause` definition remains.
  - [x] All tests pass.



### 3.29 FR-E29: Legacy Test Task Removal

- **Description:** `deno.json` contains legacy test tasks (`test:pm`, `test:tech-lead`, etc.) referencing obsolete `.flowai-workflow/scripts/stage-*_test.ts` files superseded by the engine test suite. These tasks must be removed to keep the task list accurate.
- **Motivation:** Stale tasks reference non-existent or inactive test files, pollute `deno task` output, and create false confidence that stage-level tests are running.
- **Acceptance criteria:**
  - [x] All `test:*` tasks in `deno.json` referencing `.flowai-workflow/scripts/stage-*_test.ts` paths are identified. Evidence: `deno.json` — no such tasks exist; active test tasks are `test`, `test:lib`, `test:engine` only.
  - [x] All identified obsolete tasks are removed from `deno.json`. Evidence: `deno.json:6-18` — no `.flowai-workflow/scripts/stage-*_test.ts` references present.
  - [x] All remaining active tests pass. Evidence: `deno task check` PASS (run 20260315T155429).



### 3.39 FR-E39: Standalone Binary Distribution

- **Description:** The engine compiles to standalone platform binaries via `deno compile`,
  bundling all dependencies (including `npm:yaml`). A CI/CD release workflow triggers on
  version tags (`v*`), cross-compiles binaries for 4 targets using a single `ubuntu-latest`
  runner, and publishes them as GitHub Release assets. The `VERSION` env var is embedded at
  compile time; leading `v` prefix is stripped before embedding (e.g., tag `v1.2.3` embeds
  as `1.2.3`).
- **Motivation:** Lowers adoption barrier — users run `flowai-workflow --config <path>` without
  installing Deno, eliminating runtime dependency friction.
- **Acceptance criteria:**
  - [x] AC1: Standalone binary produced by `deno compile --allow-all engine/cli.ts` with
    all deps bundled. Evidence: `scripts/compile.ts`.
  - [x] AC2: Cross-platform builds for linux-x86_64, linux-arm64, darwin-x86_64,
    darwin-arm64. Evidence: `scripts/compile.ts:TARGETS` (4 entries);
    `scripts/compile_test.ts` (4 target name tests).
  - [x] AC3: Version-tag-triggered CI release workflow.
    Evidence: `.github/workflows/release.yml:4-6` (on push tags `v*`).
  - [x] AC4: Binary naming convention `flowai-workflow-<os>-<arch>`
    (e.g., `flowai-workflow-linux-x86_64`). Evidence: `scripts/compile.ts:TARGETS`;
    `scripts/compile_test.ts` (naming convention test).
  - [x] AC5: README installation docs with binary download instructions.
    Evidence: `README.md` §Installation.
  - [x] AC6: Config-only CLI entry: `flowai-workflow --config <path>`. No Deno runtime required.
    Evidence: `engine/cli.ts:parseArgs` (`--config` flag); `deno compile` bundles all deps.
  - [x] AC7: VERSION embedded at compile time; `v` prefix stripped to avoid double-v output.
    Evidence: `scripts/compile.ts:stripVersionPrefix`; `engine/cli.ts:getVersionString`.
  - [x] `deno task check` green: 587 tests, 0 failures. Evidence: run `20260320T223114` iter 2.



### 3.41 FR-E41: CLI Auto-Update and Automated Release Pipeline

- **Description:** Automated CI pipeline on `main` push detects releasable
  conventional commits, bumps version via `standard-version`, tags, and triggers
  the release workflow. Version source of truth: `deno.json` `version` field.
- **Motivation:** Eliminates manual version management and release process.
- **Acceptance criteria:**
  - [x] AC1: `deno.json` has `version` field. Evidence: `deno.json:2`.
  - [ ] ~~AC2-AC5: Self-update functionality removed (no longer needed).~~
  - [x] AC6: `.versionrc.json` configures `standard-version` for conventional
    commit bumping. Evidence: `.versionrc.json`.
  - [x] AC7: `.github/workflows/ci.yml` auto-detects releasable commits on
    `main` push, bumps version, tags. Evidence: `.github/workflows/ci.yml:37-68`.
  - [x] AC8: `.github/workflows/release.yml` generates release notes via
    `scripts/generate-release-notes.ts`. Evidence:
    `.github/workflows/release.yml:62-73`.
  - [ ] ~~AC9: Tests for update module removed along with module.~~
  - [x] AC10: `deno task check` green: 612 tests, 0 failures.



### 3.44 FR-E44: IDE CLI Wrapper Library Split

- **Description:** The engine no longer owns the agent-CLI wrapper code
  (Claude/OpenCode/Cursor low-level runners, NDJSON stream parser,
  runtime adapter interface, HITL MCP helper, process registry). This
  layer is maintained as a standalone JSR package `@korchasa/ai-ide-cli`
  in the sibling repository
  [`korchasa/ai-ide-cli`](https://github.com/korchasa/ai-ide-cli).
  Engine depends on the library one-way via JSR
  (`jsr:@korchasa/ai-ide-cli@^0.2.0`) pinned in `engine/deno.json`. For
  local development the root workspace `deno.json` uses the `links` field
  to resolve the JSR specifier from a sibling checkout of the library
  repo. Library has zero imports from engine.
- **Motivation:** Other projects (CLI tools, agent hosts, MCP proxies)
  need Claude/OpenCode subprocess management without pulling the full
  DAG workflow engine. Independent repository + release cadence
  eliminates the monorepo-wide release coupling, isolates issue
  trackers, and lets the library follow IDE-CLI surface evolution on
  its own timeline.
- **Scope:** Library package exports unchanged from the workspace-member
  era. Repository split preserves per-file git history via
  `git filter-repo --subdirectory-filter ai-ide-cli`.
- **Acceptance:**
  - [x] `@korchasa/ai-ide-cli` lives in `korchasa/ai-ide-cli` with its
    own `deno.json`, `mod.ts`, and sub-path exports for `types`,
    `process-registry`, `runtime`, `runtime/types`, `claude/process`,
    `claude/stream`, `cursor/process`, `opencode/process`,
    `opencode/hitl-mcp`, `skill`. Evidence: sibling repo `deno.json`.
  - [x] Library has zero imports from `engine/` or
    `@korchasa/flowai-workflow`. Evidence: Grep over sibling repo.
  - [x] Engine has no imports from deleted paths
    (`./claude-process`, `./opencode-process`, `./stream`,
    `./opencode-hitl-mcp`, `./runtime/`).
  - [x] OpenCode runner's HITL MCP self-spawn is a consumer-provided
    callback (`RuntimeInvokeOptions.hitlMcpCommandBuilder`). Engine's
    `hitl-mcp-command.ts` supplies a builder pointing at engine's own
    `cli.ts`. Runner throws a clear error if a consumer sets
    `hitlConfig` without a builder. Evidence:
    `engine/hitl-mcp-command.ts`, `engine/agent.ts:179-196,290-307`,
    `engine/hitl.ts:243-256`.
  - [x] `ClaudeCliOutput` renamed to `CliRunOutput` in code (docs
    updated to match); no compatibility alias is exported.
  - [x] `@korchasa/flowai-workflow` publishes from `engine/deno.json`
    with a JSR dep on `@korchasa/ai-ide-cli@^0.2.0`;
    `@korchasa/ai-ide-cli` publishes from the sibling repo's root
    `deno.json`. Each repo `deno publish --dry-run` passes. Evidence:
    `engine/deno.json#imports`, workspace root `deno.json#links`.
  - [x] `deno compile engine/cli.ts` produces a working binary that
    inlines the library (`links` makes the local source self-contained).
  - [x] Full `deno task check` passes in flowai-workflow: fmt, lint,
    type-check engine + scripts, CLI smoke test, tests, doc lint,
    workflow integrity, agent list accuracy, comment scan. Library
    has its own `deno task check` in the sibling repo.


