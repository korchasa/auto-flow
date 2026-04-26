<!-- section file — index: [documents/design-engine.md](../design-engine.md) -->

# SDS Engine — Subsystems (phase, process, binary, backoff, release)


### 3.2 Phase Registry (`state.ts`) — IMPLEMENTED

- **Status:** Implemented. `getNodeDir()` in `state.ts` resolves
  phase-aware artifact paths. Evidence: `state.ts:20-36`
  (`setPhaseRegistry()` — builds nodeId→phase map from config),
  `state.ts:98-104` (`getNodeDir()` — phase-aware path resolution),
  `state.ts:44-46` (`getPhaseForNode()` — lookup),
  `engine.ts:135` (`setPhaseRegistry(config)` call at engine init).
- **Purpose:** Module-scoped mapping from nodeId → phase string, enabling
  `getNodeDir()` to resolve phase-aware artifact paths without signature change.
- **Data:** `phaseRegistry: Map<string, string>` — populated from
  `WorkflowConfig` via exactly one mechanism (mutual exclusivity enforced by
  config validation — FR-E33).
- **Interfaces:**
  - `setPhaseRegistry(config: WorkflowConfig)` — exclusive if/else: if
    `config.phases` exists, populates registry from `phases:` block (iterates
    phase→nodeIds mapping); else iterates config nodes, builds map from
    `nodeId → node.phase` (skips nodes without `phase`). Dual-mechanism merge
    logic removed — config validation guarantees only one mechanism is present.
    Called once at engine init (both fresh-run and `--resume` paths).
  - `clearPhaseRegistry()` — resets map. Used in tests for isolation.
  - `getPhaseForNode(nodeId: string): string | undefined` — lookup.
  - `getNodeDir(runId, nodeId)` — signature unchanged. Internally: if registry
    has phase for nodeId, returns `${runDir}/${phase}/${nodeId}/`; otherwise
    `${runDir}/${nodeId}/` (backward-compatible fallback).
- **Deps:** `types.ts` (`WorkflowConfig`, `NodeConfig`).
- **Design rationale:** Module-scoped global state (not instance state) because
  `getNodeDir()` is a free function called from multiple contexts (engine,
  templates, tests). Single-instance engine guarantee prevents sequential
  mutation. `clearPhaseRegistry()` ensures test isolation.

### 3.3 Process Registry (`process-registry.ts`) — IMPLEMENTED

- **Status:** Implemented. FR-E25.
- **Purpose:** Global singleton tracking spawned `Deno.ChildProcess` instances
  and shutdown callbacks. Enables graceful cleanup on SIGINT/SIGTERM.
- **Data:** `processes: Set<Deno.ChildProcess>`, `shutdownCallbacks: Array<() => Promise<void> | void>`.
- **Interfaces:**
  - `register(p)` / `unregister(p)` — add/remove process from tracked set.
  - `onShutdown(cb): () => void` — register cleanup callback, returns disposer.
  - `killAll()` — SIGTERM all, wait 5s, SIGKILL survivors, run callbacks.
  - `installSignalHandlers()` — idempotent; adds SIGINT+SIGTERM listeners
    that call `killAll()` then `Deno.exit(130|143)`.
- **Integration points:**
  - `agent.ts:executeClaudeProcess()` — register/unregister in try/finally.
  - `engine.ts:Engine.run()` — onShutdown for lock release + state save;
    disposers called in finally to prevent leak in loops.
  - `cli.ts`, `self-runner.ts` — installSignalHandlers() at entry point.
- **Design rationale:** Module-scoped global state (same pattern as Phase
  Registry) because signal handlers are process-wide. `_reset()` for test
  isolation. `onShutdown` disposer pattern prevents callback accumulation
  when `Engine.run()` called in a loop (`self-runner.ts`).

### 3.3a Workflow Lock (`lock.ts`) — FR-E25, FR-E54

- **Status:** Implemented.
- **Purpose:** Serialize concurrent runs **per workflow folder** (`<workflowDir>` =
  directory containing `workflow.yaml`). Distinct workflow folders own
  independent lock files and run in parallel.
- **Path contract:** `defaultLockPath(workflowDir) = "<workflowDir>/runs/.lock"`.
  The engine derives `workflowDir` once via `deriveWorkflowDir(options.config_path)`
  in the `Engine` constructor and passes it to `defaultLockPath` at acquisition
  time. `EngineOptions.lock_path` override (tests only) bypasses the derivation.
- **Lock content (`LockInfo`):** `{ pid, hostname, run_id, started_at }`.
  Hostname stored for diagnostics only — local FS implies a shared PID
  namespace, so `Deno.kill(pid, "SIGCONT")` is the authoritative liveness
  check (FR-E25). Stale-on-dead-PID lock is reclaimed transparently.
- **Interfaces:**
  - `defaultLockPath(workflowDir: string): string` — pure helper, returns
    `<workflowDir>/runs/.lock`.
  - `acquireLock(lockPath, runId)` — throws when a live PID holds the file;
    reclaims on dead PID; rewrites on `SyntaxError` (corrupted file).
  - `releaseLock(lockPath)` — idempotent unlink.
  - `readLockInfo(lockPath)` — debug helper.
- **Integration points:**
  - `engine.ts::Engine.run()` — `defaultLockPath(this.workflowDir)`,
    `acquireLock` before any side-effecting work, `releaseLock` in `finally`,
    `onShutdown(() => releaseLock(...))` for SIGINT/SIGTERM cleanup.
- **Cross-workflow parallelism:** Each workflow folder owns its
  `<workflowDir>/runs/<run-id>/` umbrella, which holds both per-run state
  (FR-E9) and the per-run git worktree (FR-E57: `runs/<run-id>/worktree/`,
  superseding the pre-FR-E57 repo-global `.flowai-workflow/worktrees/`
  namespace). Per-folder locking aligns the concurrency unit with the
  artifact-namespace boundary. No global serialization point remains.
- **Legacy:** Pre-FR-E54 binaries used a fixed `.flowai-workflow/runs/.lock`
  path. After upgrade, that file is orphaned (never consulted) and may be
  deleted manually. No automatic migration.

### 3.4 Binary Distribution (`scripts/compile.ts`) — FR-E39

- **Status:** Pending.
- **Purpose:** Cross-platform standalone binary compilation via `deno compile`.
  Eliminates Deno prerequisite for end users.
- **Compile Script** (`scripts/compile.ts`):
  - Accepts `--target <triple>` for single-target or no args for all 4 targets.
  - Targets: `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`,
    `x86_64-apple-darwin`, `aarch64-apple-darwin`.
  - Output naming: `flowai-workflow-<os>-<arch>` (e.g., `flowai-workflow-linux-x86_64`).
  - Invokes: `deno compile --target <t> --env VERSION=<v> --output <name>
    cli.ts` per target.
  - `--version` flag value: reads `VERSION` env var, falls back to `"dev"`.
- **deno.json task:** `"compile": "deno run -A scripts/compile.ts"`.
- **GitHub Actions Workflow** (`.github/workflows/release.yml`):
  - Trigger: `push` with `tags: ["v*"]`.
  - Matrix strategy: 4 jobs (one per target triple).
  - Each job: checkout → setup Deno → `deno task compile --target <triple>`
    → upload artifact.
  - Final `release` job (`needs: [build]`): download all artifacts → create
    GitHub Release (`GITHUB_REF_NAME` as tag) → attach binaries.
  - Version string: extracted from `GITHUB_REF_NAME` (strips `v` prefix),
    passed via `VERSION` env to compile script.
- **Deps:** Deno compile toolchain, GitHub Actions.
- **Design rationale:** Compile script is both local-dev tool (`deno task
  compile`) and CI building block. Matrix CI parallelizes builds (~1× instead
  of 4× wall time). Version embedding via `--env` avoids code generation or
  build-time file patching.

### 3.5 Shared Backoff Utility (`scripts/backoff.ts`) — FR-E28

- **Status:** Pending.
- **Purpose:** Single authoritative source for exponential backoff logic used by
  `scripts/self-runner.ts`. Eliminates duplicated `nextPause()` function and
  associated constants.
- **Exports:**
  - `MIN_PAUSE_SEC` (60) — minimum pause / reset value on success.
  - `MAX_PAUSE_SEC` (14400) — 4h cap.
  - `BACKOFF_FACTOR` (2) — multiplier per iteration.
  - `nextPause(current: number): number` — returns
    `Math.min(current * BACKOFF_FACTOR, MAX_PAUSE_SEC)`.
- **Consumers:** `self-runner.ts` — imports `nextPause` and `MIN_PAUSE_SEC`
  (used for pause reset on success).
- **Tests:** `scripts/backoff_test.ts` — 3 tests (doubling, max cap, min floor)
  moved from `self-runner_test.ts`.
- **Deps:** None (pure function, no imports).

### 3.5 Binary Compile Script (`scripts/compile.ts`) — FR-E39

- **Status:** Pending.
- **Purpose:** Cross-platform binary build via `deno compile`. Generates
  self-contained executables for distribution without Deno on target.
- **Targets:** 4 platform tuples as constant array:
  `[{os: "linux", arch: "x86_64", denoTarget: "x86_64-unknown-linux-gnu"},
   {os: "linux", arch: "arm64", denoTarget: "aarch64-unknown-linux-gnu"},
   {os: "darwin", arch: "x86_64", denoTarget: "x86_64-apple-darwin"},
   {os: "darwin", arch: "arm64", denoTarget: "aarch64-apple-darwin"}]`
- **Output:** `dist/flowai-workflow-<os>-<arch>` per target.
- **Flags:** `--allow-all` (engine needs Deno.Command, env, file I/O).
  Entry: `cli.ts`.
- **CLI:** `--dry-run` prints commands without executing.
- **Tests:** `scripts/compile_test.ts` — target list, filename convention,
  dry-run behavior.
- **Deps:** Deno std only (no external).

### 3.6 Release CI Workflow — FR-E39, FR-E41

- **Purpose:** Automated release pipeline: check, version bump, compile, publish.
- **Two-workflow design:**
  - `ci.yml` (on push to `main` + PRs): `deno task check` → detect releasable
    conventional commits since last tag → `standard-version` bumps
    `deno.json` version + CHANGELOG.md → git tag `v<ver>` → push
  - `release.yml` (on tag `v*`): matrix compile (4 targets) → generate
    release notes via `scripts/generate-release-notes.ts` → `gh release create`
    with binary assets
- **Version bumping:** `.versionrc.json` configures `standard-version` (npm
  package). Reads conventional commits, updates `deno.json` version field,
  generates `CHANGELOG.md`. Task: `deno task release`.
- **Release notes:** `scripts/generate-release-notes.ts` — parses conventional
  commit subjects between tags, categorizes (feat/fix/refactor/perf/docs/build),
  generates markdown with GitHub compare link.
- **Assets:** 4 binaries named `flowai-workflow-<os>-<arch>`.


