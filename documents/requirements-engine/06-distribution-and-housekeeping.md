<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — Distribution and Housekeeping


### 3.26 FR-E26: Engine Codebase Housekeeping

- **Description:** Engine source tree must remain free of dead code and stale documentation. Barrel export files with no runtime or test consumers must be removed. Pre-implementation research docs in `documents/rnd/` superseded by implemented FRs must be deleted or archived. Empty run artifact directories must not be tracked in version control.
- **Motivation:** `engine/mod.ts` is a barrel re-export not imported by runtime code or tests (only referenced as a type-check target in `deno task check`). Retaining it without a clear owner creates confusion about the engine's public API surface. `documents/rnd/human-in-the-loop.md` (18KB, Russian, 2026-03-11) predates the HITL implementation (FR-E8) and may be superseded by it. Empty `.flowai-workflow/runs/*/implementation` directories accumulate from loop iterations; `.gitignore` covers `.flowai-workflow/runs/` but stale tracked entries must be purged.
- **Acceptance criteria:**
  - [x] `engine/mod.ts` purpose documented via module-level JSDoc: barrel re-export for `deno doc --lint`. Evidence: `engine/mod.ts:1`.
  - [x] `documents/rnd/human-in-the-loop.md` deleted — superseded by `engine/hitl.ts` + SDS §5 HITL documentation. Evidence: file removed from repo.
  - [x] Empty `.flowai-workflow/runs/*/implementation` directories are not git-tracked; `.gitignore` covers `runs/` directory.



### 3.27 FR-E27: Test Suite Integrity

- **Description:** Every test function in `engine/` test files must contain ≥1 explicit assertion. Tests with no assertions pass trivially, provide zero coverage value, and mask implementation errors.
- **Motivation:** `engine/lock_test.ts:143` — test "releaseLock - no error if lock file already removed" contained no assertions, silently passing while verifying nothing.
- **Acceptance criteria:**
  - **Tests:** `lock_test.ts` (regression-locked; one-time hygiene
    fix: `releaseLock - no error if lock file already removed` now
    asserts the return value).



### 3.28 FR-E28: Shared Backoff Utility (`nextPause()`)

- **Description:** `nextPause()` function lives in a single module `scripts/backoff.ts` so all loop runners share one implementation.
- **Motivation:** DRY — backoff logic changes apply in one place.
- **Acceptance criteria:**
  - **Tests:** `scripts/backoff_test.ts` (regression-locked;
    `nextPause` doubles, caps at 4h, progression from 30s).
  - [x] `scripts/backoff.ts` exists and exports `nextPause()`.
  - [x] `scripts/self-runner.ts` imports `nextPause` from `scripts/backoff.ts`;
    no local `nextPause` definition remains.



### 3.29 FR-E29: Legacy Test Task Removal

- **Description:** `deno.json` contains legacy test tasks (`test:pm`, `test:tech-lead`, etc.) referencing obsolete `.flowai-workflow/scripts/stage-*_test.ts` files superseded by the engine test suite. These tasks must be removed to keep the task list accurate.
- **Motivation:** Stale tasks reference non-existent or inactive test files, pollute `deno task` output, and create false confidence that stage-level tests are running.
- **Acceptance criteria:**
  - [x] All `test:*` tasks in `deno.json` referencing `.flowai-workflow/scripts/stage-*_test.ts` paths are identified. Evidence: `deno.json` — no such tasks exist; active test tasks are `test`, `test:lib`, `test:engine` only.
  - [x] All identified obsolete tasks are removed from `deno.json`. Evidence: `deno.json:6-18` — no `.flowai-workflow/scripts/stage-*_test.ts` references present.



### 3.39 FR-E39: Standalone Binary Distribution

- **Description:** The engine compiles to standalone platform binaries via `deno compile`,
  bundling all dependencies (including `npm:yaml`). A CI/CD release workflow triggers on
  version tags (`v*`), cross-compiles binaries for 4 targets using a single `ubuntu-latest`
  runner, and publishes them as GitHub Release assets. The `VERSION` env var is embedded at
  compile time; leading `v` prefix is stripped before embedding (e.g., tag `v1.2.3` embeds
  as `1.2.3`).
- **Motivation:** Lowers adoption barrier — users run
  `flowai-workflow run <workflow>` without installing Deno,
  eliminating runtime dependency friction.
- **Acceptance criteria:**
  - **Tests:** `scripts/compile_test.ts`, `cli_test.ts`
    (regression-locked; 4-target list, naming convention,
    `stripVersionPrefix`, `getVersionString`).
  - [x] AC1: Standalone binary produced by `deno compile --allow-all
    engine/cli.ts` with all deps bundled. Evidence: `scripts/compile.ts`.
  - [x] AC3: Version-tag-triggered CI release workflow.
    Evidence: `.github/workflows/release.yml:4-6` (on push tags `v*`).
  - [x] AC5: README installation docs with binary download instructions.
    Evidence: `README.md` §Installation.



### 3.41 FR-E41: CLI Auto-Update and Automated Release Pipeline

- **Description:** Automated CI pipeline on `main` push detects releasable
  conventional commits, bumps version via `standard-version`, tags, and triggers
  the release workflow. Version source of truth: `deno.json` `version` field.
- **Motivation:** Eliminates manual version management and release process.
- **Acceptance criteria:**
  - [x] AC1: `deno.json` has `version` field. Evidence: `deno.json:2`.
  - [x] AC6: `.versionrc.json` configures `standard-version` for conventional
    commit bumping. Evidence: `.versionrc.json`.
  - [x] AC7: `.github/workflows/ci.yml` auto-detects releasable commits on
    `main` push, bumps version, tags. Evidence: `.github/workflows/ci.yml:37-68`.
  - [x] AC8: `.github/workflows/release.yml` generates release notes via
    `scripts/generate-release-notes.ts`. Evidence:
    `.github/workflows/release.yml:62-73`.
  - AC2-AC5, AC9: removed — self-update functionality and its tests
    deleted; criteria no longer applicable.



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

  **Scope:** Library package exports unchanged from the workspace-member
  era. Repository split preserves per-file git history via
  `git filter-repo --subdirectory-filter ai-ide-cli`.
- **Motivation:** Other projects (CLI tools, agent hosts, MCP proxies)
  need Claude/OpenCode subprocess management without pulling the full
  DAG workflow engine. Independent repository + release cadence
  eliminates the monorepo-wide release coupling, isolates issue
  trackers, and lets the library follow IDE-CLI surface evolution on
  its own timeline.
- **Acceptance criteria:**
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



### 3.59 FR-E59: Phase Registry Scoped to Run

- **Description:** The `nodeId → phase` mapping (FR-E9) lives on a per-run
  `PhaseRegistry` instance constructed at the top of `Engine.run()` from the
  loaded workflow config. No module-level state. Two consecutive
  `Engine.run()` calls in the same Deno process keep their phase mappings
  isolated — Run B's path computations are derived strictly from Run B's
  own `phases:` (or per-node `phase:` fields), regardless of what Run A
  configured.
- **Motivation:** Library hosts (e.g. `flowai-center`) drive a sequential
  queue of `Engine.run()` calls in one Deno process. Module-level mapping
  let Run A's mapping persist into Run B and route Run B's nodes into Run
  A's phase folders, breaking artifact isolation.
- **ADR:** [documents/adrs/0007-phase-registry-per-run.md](../adrs/0007-phase-registry-per-run.md)
- **Acceptance criteria:**
  - **Tests:** `engine_test.ts` (FR-E59; regression-locked). See ADR-0007.



### 3.60 FR-E60: Caller-Supplied ProcessRegistry Injection

- **Description:** `EngineOptions` and `AgentRunOptions` accept an optional
  `processRegistry?: ProcessRegistry` (type imported from
  `@korchasa/ai-ide-cli/process-registry`). When supplied, every child
  process spawned during the `Engine.run()` call (runtime CLI invocations,
  HITL MCP helpers, continuation re-invocations) registers in the supplied
  instance instead of the package-wide default singleton. Omitting the
  option keeps the legacy default-singleton behavior bit-for-bit.
- **Motivation:** Library hosts run `Engine` alongside other long-lived
  subsystems (chat dispatchers, schedulers, MCP servers). A host-owned
  `ProcessRegistry` lets the host call `killAll()` on its own scope to
  terminate ONLY this engine's children — sibling subprocesses keep
  running.
- **Acceptance criteria:**
  - **Tests:** `engine_test.ts` (FR-E60; regression-locked).



### 3.61 FR-E61: Signal Handler Boundary

- **Description:** `installSignalHandlers()` is exposed as a publicly
  documented entry point intended exclusively for autonomous bin entry
  points (`cli.ts`, `scripts/self-runner.ts`). The `Engine` class MUST
  NOT call it — neither directly nor transitively through any of its
  methods. A library host that embeds `Engine.run()` in its own Deno
  process keeps full control over signal routing, log handling, and
  shutdown sequencing.
- **Motivation:** Embedding hosts already own SIGINT/SIGTERM listeners
  (often translating them into queue-cancellation, not process exit).
  An engine-installed handler would call `Deno.exit(130|143)` and kill
  unrelated host work.
- **ADR:** [documents/adrs/0008-signal-handler-boundary.md](../adrs/0008-signal-handler-boundary.md)
- **Acceptance criteria:**
  - **Tests:** `engine_test.ts` (FR-E61; regression-locked). See ADR-0008.
  - [x] `process-registry.ts` documents `installSignalHandlers` as
    bin-entry-point-only and explicitly disclaims its use from `Engine`.
    Evidence: `process-registry.ts` module-level JSDoc.
  - [x] README has an "Embedding vs standalone use" section distinguishing
    the library-mode contract from the bin-mode contract. Evidence:
    `README.md`.



### 3.63 FR-E63: ADR Process

- **Description:** Architectural decisions are recorded as
  Architecture Decision Records (ADRs) under `documents/adrs/`. ADRs
  use Michael Nygard's format (Status / Context / Decision /
  Consequences / Alternatives Considered), are append-only once
  `Accepted`, evolve via new ADRs that link back via
  `Superseded by ADR-NNNN`, and are numbered monotonically with no
  gaps. The set is lint-checked at `deno task check`. This is a
  process meta-FR — defines the ADR mechanism itself; no single
  back-fill ADR record. The directory and lint that implement it
  live at [documents/adrs/](../adrs/) and
  `scripts/check.ts::validateAdrSet`.

  **Constraints:**
  - One ADR per file. Filename `^\d{4}-[a-z0-9-]+\.md$`. Numbers
    contiguous from `0001`, no gaps, no duplicates.
  - Required level-2 sections, exact wording and order:
    `## Status`, `## Context`, `## Decision`, `## Consequences`,
    `## Alternatives Considered`.
  - `Status` ∈ {`Proposed`, `Accepted`, `Superseded by ADR-NNNN`};
    when superseded, the referenced ADR-NNNN MUST exist.
  - All `ADR-NNNN` cross-references in ADR bodies MUST resolve to
    existing files.
  - ADRs fit the per-file `documents/` token budget
    (`docsTokenBudget`, FR-E5).
- **Motivation:** "Why was it built this way?" used to require
  `git log` + AGENTS.md prose archaeology. New contributors couldn't
  locate rationale without inside knowledge. ADRs anchor the
  decisions on a stable, navigable surface; FRs say what is true,
  ADRs say why.
- **Acceptance criteria:**
  - **Tests:** `scripts/check_test.ts` (regression-locked;
    `validateAdrSet` covers filename pattern, monotonic numbering,
    required sections, status values, cross-link resolution).
  - [x] `documents/adrs/` directory exists with `README.md` (index)
    and `_template.md` (skeleton). Evidence:
    `documents/adrs/README.md`, `documents/adrs/_template.md`.
  - [x] At least 8 back-filled ADRs covering the most consequential
    historical decisions (10 ADRs land at FR-E63 introduction;
    ADR-0011 codifies this acceptance-block convention). Evidence:
    `documents/adrs/0001-...md` through `documents/adrs/0011-...md`.
  - [x] AGENTS.md "Key Decisions" section links each bullet to its
    ADR. Evidence: `AGENTS.md` "Key Decisions" section.
  - [x] FR-E acceptance criteria for E47/E51/E52/E54/E57/E59/E61
    cross-link to corresponding ADRs (FR-E50/E58 link to ADR-0001
    pending the isolation-provider plugin landing). Evidence: this
    file + `04b-worktree-isolation.md`, `05-cli-and-observability.md`.


