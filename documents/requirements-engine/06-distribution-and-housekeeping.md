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
- **Tasks:** [plugin-first-distribution](../tasks/2026/05/plugin-first-distribution.md)
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
- **Tasks:** [plugin-first-distribution](../tasks/2026/05/plugin-first-distribution.md)
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
- **Decision:** [documents/tasks/2026/05/phase-registry-per-run.md](../tasks/2026/05/phase-registry-per-run.md)
- **Acceptance criteria:**
  - **Tests:** `engine_test.ts` (FR-E59; regression-locked). See phase-registry-per-run.



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
- **Decision:** [documents/tasks/2026/05/signal-handler-boundary.md](../tasks/2026/05/signal-handler-boundary.md)
- **Acceptance criteria:**
  - **Tests:** `engine_test.ts` (FR-E61; regression-locked). See signal-handler-boundary.
  - [x] `process-registry.ts` documents `installSignalHandlers` as
    bin-entry-point-only and explicitly disclaims its use from `Engine`.
    Evidence: `process-registry.ts` module-level JSDoc.
  - [x] README has an "Embedding vs standalone use" section distinguishing
    the library-mode contract from the bin-mode contract. Evidence:
    `README.md`.



### 3.63 FR-E63: Decision-Task Process

- **Description:** Architectural decisions are recorded as permanent
  task files under `documents/tasks/<YYYY>/<MM>/adr-NNNN-<slug>.md`.
  Each decision-task carries GODS-format frontmatter (`date`,
  `status`, `implements`, `tags`, `related_tasks`) and a body with
  `Goal`, `Overview` (Context / Current State / Constraints),
  `Definition of Done` (with `[x]` items checked when implemented),
  and `Solution` (preserving the original Decision + Alternatives
  Considered prose). Decisions evolve via new tasks that reference
  the predecessor in `supersedes:` frontmatter. This is a process
  meta-FR — defines the decision-record mechanism itself; no single
  back-fill record.
- **Motivation:** "Why was it built this way?" used to require
  `git log` + AGENTS.md prose archaeology. New contributors couldn't
  locate rationale without inside knowledge. Decision-tasks anchor
  the rationale on a stable, navigable surface alongside the
  ordinary task layout; FRs say what is true, decision-tasks say
  why. Folding decisions into the task system (rather than a
  separate `documents/tasks/` tree) collapses two parallel
  numbering/format conventions into one.
- **Acceptance criteria:**
  - [x] `documents/tasks/2026/05/adr-*.md` files cover the back-filled
    historical decisions. Evidence:
    `documents/tasks/2026/05/isolation-provider.md` through
    `documents/tasks/2026/05/remove-git-from-engine.md`.
  - [x] AGENTS.md "Key Decisions" section links each bullet to its
    decision-task. Evidence: `AGENTS.md` "Key Decisions" section.
  - [x] FR-E acceptance criteria for E47/E51/E52/E54/E57/E59/E61
    cross-link to corresponding decision-tasks (FR-E50/E58 link to
    `isolation-provider` pending the isolation-provider
    plugin landing). Evidence: this file +
    `04b-worktree-isolation.md`, `05-cli-and-observability.md`.



### 3.70 FR-E70: Claude Code / Codex Plugin Distribution

- **Description:** The Claude Code / Codex plugin is the primary
  distribution channel for `flowai-workflow`. The downstream marketplace
  lives in a dedicated public repo `korchasa/flowai-workflow-plugins`
  (see FR-E72 for the cross-repo sync mechanism) and is consumed via:

  ```
  /plugin marketplace add korchasa/flowai-workflow-plugins --sparse claude
  /plugin install flowai-workflow@korchasa
  ```

  The engine source repo holds the plugin source tree at `plugin-src/`.
  Shared runtime files (`bin/launch.ts`, `skills/`, `agents/`,
  plugin-root `README.md`) live under `plugin-src/shared/`. Claude
  marketplace wiring lives under `plugin-src/claude/`; Codex wiring
  lives under `plugin-src/codex/` with a Codex-native
  `.agents/plugins/marketplace.json`. Launcher skills invoke the
  self-locating `bin/launch.ts`, which dispatches to the compiled
  engine binary and uses the plugin-bundled workflows for `init`.
  Pre-flight: each launcher asserts `deno --version` and fails fast
  with a README link when Deno is absent (no silent fallback, per
  AGENTS.md).

  The build-time payload (committed to `flowai-workflow-plugins`) is
  assembled by `scripts/build-plugin-payload.ts` from the engine repo
  into two marketplace roots: `claude/` and `codex/`. Each root gets
  shared runtime files, engine TS sources under
  `plugins/flowai-workflow/engine/`, bundled `.flowai-workflow/<name>/`
  workflows, host-specific plugin manifests, host-specific MCP config,
  and a patched `engine/deno.json` with the `publish` stanza and dev
  tasks stripped. `marketplace.json#plugins[0].version` and
  `plugin.json#version` are pinned to the engine's `deno.json#version`
  on every build, so plugin version is byte-equal to the engine
  version that produced it (version-lockstep contract). Per-run dirt
  (`.flowai-workflow/*/runs/`, `memory/agent-*.md`, `.template.json`)
  is excluded by `classifyPayloadFile`.

  Self-contained-runtime extension (lazy compile of the engine into
  `${CLAUDE_PLUGIN_DATA}/bin/` on first call + auto-MCP registration
  via host-specific payload-shipped MCP config is specified in FR-E74.

  **Predecessor design (historical).** Before the plugin-first
  migration the marketplace was named `flowai-workflow-local` and
  installed via `deno task sync-claude-plugin`
  (`scripts/sync-claude-plugin.ts`) which re-pointed the local
  marketplace at the checkout and ran `claude plugin install`/`update`
  at user scope. That dogfood UX is replaced by
  `deno task sync-plugins-local` (FR-E72) and the
  CI-driven downstream-repo push for public consumption.
- **Tasks:** [plugin-first-distribution](../tasks/2026/05/plugin-first-distribution.md)
- **Motivation:** Lower install friction to two slash-commands inside
  the AI IDE: no separate `deno install`, no per-IDE binary download,
  no manual `~/.codex/config.toml` patch. Mirrors the foxcode reference
  pattern but ships the engine itself rather than only skill files.
- **Acceptance criteria:**
  - **Tests:** `scripts/build-plugin-payload_test.ts`,
    `init/mod_test.ts` (FR-E70; regression-locked; covers payload
    shape, version lockstep, per-run-dirt exclusion, `--bundle-dir`
    flag).
  - [x] Marketplace renamed to `flowai-workflow` (was
    `flowai-workflow-local`); plugin manifest version pinned to
    engine `deno.json#version`.
    Evidence: `plugin-src/claude/.claude-plugin/marketplace.json`,
    `plugin-src/codex/.agents/plugins/marketplace.json`,
    `plugin-src/claude/plugins/flowai-workflow/.claude-plugin/plugin.json`,
    `plugin-src/codex/plugins/flowai-workflow/.codex-plugin/plugin.json`.
  - [x] Launcher skills `run/` and `init/` exist with `deno --version`
    preflight + `FLOWAI_SUPPRESS_DEPRECATION=1` env wrap.
    Evidence:
    `plugin-src/shared/skills/run/SKILL.md`,
    `plugin-src/shared/skills/init/SKILL.md`.
  - [x] `cli.ts init` accepts `--bundle-dir <path>` to override the
    package-relative bundled-workflows lookup.
    Evidence: `init/mod.ts`.
  - [ ] Full plugin install smoke: in a fresh Claude Code session,
    `/plugin marketplace add korchasa/flowai-workflow-plugins --sparse claude` and
    `/plugin install flowai-workflow@korchasa` succeed; `/flowai-workflow:run
    --help` returns the engine help text. Manual — korchasa; Evidence:
    transcript pasted in release PR body.
  - [ ] Full plugin install smoke on Codex: `codex plugin marketplace
    add korchasa/flowai-workflow-plugins --sparse codex` + `codex plugin add
    flowai-workflow@flowai-workflow` succeed; invoking the run skill returns
    engine help. Manual — korchasa; Evidence: transcript pasted in
    release PR body.



### 3.71 FR-E71: Codex Plugin Install Path

- **Description:** Codex installs the `flowai-workflow` plugin via its
  native plugin manager — no `[mcp_servers.*]` block in
  `~/.codex/config.toml` is required. Install path:

  ```
  codex plugin marketplace add korchasa/flowai-workflow-plugins --sparse codex
  codex plugin add flowai-workflow@flowai-workflow
  ```

  After install, Codex's native plugin manager loads launcher skills
  (`run`, `init`, `scaffold`, `supervise`, `orchestrate`) and the
  plugin-shipped MCP config from
  `plugins/flowai-workflow/.mcp.json`. The MCP server name remains
  `flowai-workflow`; users should not enable official and
  local installs simultaneously during MCP smoke tests.

  Exact Codex skill-invocation syntax (`$flowai-workflow:run` vs
  `$flowai-workflow-run` vs other) is verified at release time against
  the actual Codex build and documented in README; this FR commits to
  the contract that the launcher skills are callable from inside Codex
  after `codex plugin add`, not to a specific prefix shape.
- **Tasks:** [plugin-first-distribution](../tasks/2026/05/plugin-first-distribution.md), [plugin-ci-mcp-hooks-smoke](../tasks/2026/05/plugin-ci-mcp-hooks-smoke.md)
- **Motivation:** Match the foxcode reference UX while clarifying
  where plugin-owned auto-MCP config lives. Eliminates the "do I need
  a config.toml block?" question for every new user.
- **Dep:** FR-E70, FR-E72
- **Acceptance criteria:**
  - [ ] Full Codex install smoke per FR-E70 (manual — korchasa).
  - [ ] CI install smoke builds the official publish-shape payload
    from the source repo, registers it as marketplace
    `flowai-workflow` inside an isolated temp host home, installs
    `flowai-workflow@flowai-workflow`, and verifies the installed
    plugin cache rather than the source tree. Evidence:
    `scripts/plugin-install-smoke_test.ts::FR-E72 official payload installs from source repo into isolated host home`.
  - [ ] Codex hook payload validation is automated when hooks are
    bundled, but Codex hook trust remains a user review step and is
    not claimed as auto-enabled by CI. Evidence:
    `scripts/plugin-install-smoke_test.ts::FR-E71 installed plugin hook smoke validates and executes bundled hook commands`.
  - [ ] README's Codex install section documents the two commands
    AND explicitly states no `config.toml` patch is required because
    the Codex plugin payload ships MCP config. Manual — korchasa;
    Evidence:
    `grep -n "codex plugin marketplace add" README.md`.



### 3.72 FR-E72: Cross-Repo Plugin Payload Sync

- **Description:** On every engine version tag (`v*` push to the source
  repo), the GH Actions workflow `.github/workflows/sync-plugins.yml`
  builds the plugin payload (via FR-E70's
  `scripts/build-plugin-payload.ts`) and pushes it into the public
  downstream repo `korchasa/flowai-workflow-plugins` via
  `scripts/sync-plugins-repo.ts`. The downstream repo is autogenerated
  — manual edits are overwritten by the next sync.

  **Sync contract:**

  1. Clone `korchasa/flowai-workflow-plugins` (depth=1) using a PAT
     stored as the engine-repo secret `PLUGINS_REPO_TOKEN`
     (required `contents:write` scope on the target repo).
  2. Build the new payload into a staging tempdir (or directly into
     the clone after wiping its contents except `.git/`).
  3. `git status --porcelain` — if empty, exit clean without commit,
     tag, or push (idempotency: byte-equal payload is a no-op).
  4. Otherwise commit with message
     `release: vX.Y.Z (synced from engine@<short-sha>)`, tag `vX.Y.Z`,
     push `HEAD:main` + tag.

  **Modes** (`--mode publish | dry-run`):

  - `publish` (CI default): full clone → build → commit → push.
  - `dry-run`: build into `--out-dir dist/plugin-payload` (or any
    `--out-dir <path>`), no git ops. Replaces `deno task sync-claude-plugin`
    for local payload inspection.

  Local-dev install lives in `scripts/sync-plugins-local.ts`
  (`deno task sync-plugins-local`) — see this FR's acceptance criteria
  for its contract (Codex reconcile, `enabled=false` preservation,
  `AUTO_INSTALL_PLUGINS` gate).

  Prerequisites (one-time, manual): downstream repo must exist; PAT
  must be issued and stored as `PLUGINS_REPO_TOKEN`; both surfaced in
  the workflow file's top-of-file comment.
- **Tasks:** [plugin-first-distribution](../tasks/2026/05/plugin-first-distribution.md), [local-plugin-install-script](../tasks/2026/05/local-plugin-install-script.md), [plugin-ci-mcp-hooks-smoke](../tasks/2026/05/plugin-ci-mcp-hooks-smoke.md)
- **Motivation:** Single source of truth (engine repo) with isolated
  release cadence for the plugin payload. Atomic per-tag publish:
  same CI run that tags the engine pushes the matching plugin
  version. No two-repo divergence; no manual sync step in the
  release checklist.
- **Dep:** FR-E70
- **Acceptance criteria:**
  - **Tests:** `scripts/sync-plugins-repo_test.ts`, `scripts/sync-plugins-local_test.ts`
    (FR-E72; regression-locked; covers idempotent no-op, commit + tag
    + push on diff, dry-run produces tree without push, `enabled=false`
    preserved through reinstall, Codex `config.toml` reconcile + idempotency,
    `AUTO_INSTALL_PLUGINS` literal-true gate, fail-fast arg parsing,
    removed `install-local` mode rejected).
  - [x] `.github/workflows/sync-plugins.yml` triggers on
    `push: tags: ['v*']` and on `workflow_dispatch`; runs the sync
    script with `--mode publish`. Untrusted inputs routed via `env:`
    block (no `${{ inputs.* }}` interpolation inside `run:` shell
    bodies). Evidence: `.github/workflows/sync-plugins.yml`.
  - [x] `deno task sync-plugins` wired in `deno.json#tasks` and
    forwards CLI args. Evidence: `deno.json#tasks.sync-plugins`.
  - [x] `deno task sync-plugins-local` wired in `deno.json#tasks` for
    the local dogfood loop (rebuild payload + reinstall into Claude
    Code + reconcile Codex). Evidence: `deno.json#tasks.sync-plugins-local`.
  - [x] Local-install AC (moved from `sync-plugins-repo.ts`, not
    deleted): missing `claude` CLI is a soft skip, marketplace is
    re-registered against a fresh build, and `claude plugin install`
    is invoked at user scope for every emitted plugin. Evidence:
    `scripts/sync-plugins-local.ts:syncClaude`.
  - [x] Codex soft-skip: missing `codex` binary OR Codex CLI without
    the `plugin marketplace` subcommand (<0.130) logs a precise skip
    message and exits the Codex path cleanly; the Claude path still
    runs. Evidence: `scripts/sync-plugins-local.ts:syncCodex`.
  - [x] Codex local install runs `codex plugin add
    flowai-workflow@flowai-workflow-local` after marketplace
    registration so the payload cache exists and `codex plugin list`
    reports the plugin as installed. Evidence:
    `scripts/sync-plugins-local.ts:planCodexPluginAdds`.
  - [x] User-scope `enabled = false` is preserved through
    install/reinstall: `claude plugin list --json` is captured BEFORE
    `marketplace remove`, then disabled plugins route to a `skipped`
    bucket on reinstall. Evidence:
    `scripts/sync-plugins-local.ts:planClaudeActions`.
  - [x] `AUTO_INSTALL_PLUGINS` opt-in gate accepts only literal `true`
    (env var OR `.env`) and is wired into `deno task check`; absence
    is a no-op. Evidence:
    `scripts/sync-plugins-local.ts:shouldAutoInstall`,
    `scripts/check.ts` (`runIfAutoInstallEnabled` invocation).
  - [ ] Publish workflow validates the official split payload roots
    from the source repo before push and re-validates a downstream
    clone after push; smoke paths target `claude/` and `codex/` roots,
    not the retired pre-split `plugins/flowai-workflow` root.
    Evidence:
    `scripts/sync-plugins-repo_test.ts::FR-E72 publish smoke command targets host-specific payload roots`.
  - [ ] Public repo `korchasa/flowai-workflow-plugins` created (MIT,
    public, empty `main`). Manual — korchasa; Evidence:
    `gh repo view korchasa/flowai-workflow-plugins --json visibility,licenseInfo`.
  - [ ] `PLUGINS_REPO_TOKEN` secret configured in engine-repo
    Actions with `contents:write` on target repo. Manual — korchasa;
    Evidence: `gh secret list --repo korchasa/flowai-workflow | grep PLUGINS_REPO_TOKEN`.
  - [ ] First end-to-end sync (manual `workflow_dispatch` run after
    prerequisites) produces a tag and a commit in the downstream
    repo; payload-integrity smoke step passes (deno-run --version
    against the synced engine). Manual — korchasa; Evidence:
    GH Actions run URL in the release PR body.
