<!-- section file — index: [documents/design-engine.md](../design-engine.md) -->

# SDS Engine — Subsystems (phase, process, binary, backoff, release)


### 3.2 Phase Registry (`state.ts`) — IMPLEMENTED (FR-E9, FR-E59)

- **Status:** Implemented. `state.ts::PhaseRegistry` is a per-run instance
  holding a private `Map<string, string>`. `Engine.runWithLock` builds a
  fresh `PhaseRegistry.fromConfig(this.config)` at run start and threads it
  through `getNodeDir`/`buildTaskPaths` and the `EngineContext`.
- **Purpose:** Map `nodeId → phase string` for the duration of one
  `Engine.run()`, enabling `getNodeDir` to resolve phase-aware artifact
  paths. Per-run lifetime is mandatory for library-mode hosts that drive a
  sequential queue of `Engine.run()` calls in one Deno process — module-
  scoped state would let Run A's mapping leak into Run B (FR-E59).
- **Data:** Private `Map<string, string>` per instance. Populated from a
  `WorkflowConfig` via exactly one mechanism (mutual exclusivity enforced
  by config validation — FR-E33).
- **Interfaces:**
  - `static PhaseRegistry.fromConfig(config: WorkflowConfig): PhaseRegistry`
    — exclusive if/else: if `config.phases` exists, iterates phase→nodeIds
    mapping; else iterates config nodes and builds map from
    `nodeId → node.phase` (skips nodes without `phase`).
  - `static PhaseRegistry.empty(): PhaseRegistry` — used by callers without
    a phase mapping (legacy tests, dry-run summaries).
  - `instance.get(nodeId: string): string | undefined` — lookup.
  - `getNodeDir(runId, nodeId, workflowDir, phaseRegistry?)` — when
    `phaseRegistry` is present and maps `nodeId → phase`, returns
    `${runDir}/${phase}/${nodeId}/`; otherwise the flat
    `${runDir}/${nodeId}/` (back-compat for callers that omit the
    registry).
  - `buildTaskPaths(runId, nodeId, inputs, workflowDir, phaseRegistry?)` —
    threads the same registry into every `node_dir` and `input.<id>`
    computation so loop-body and predecessor paths inherit the active
    mapping consistently.
- **Deps:** `types.ts` (`WorkflowConfig`, `NodeConfig`).
- **Design rationale:** Per-run instance over module-level state because
  the engine is library-embeddable. Hosts run sequential `Engine.run()`
  calls; module-level mutable state would leak phase mappings across
  runs and silently misroute artifacts. Path helpers stay free
  functions (no capture of `this`) so legacy unit tests with no
  registry continue to compile and produce flat paths — the registry
  parameter is optional. Within one run, the registry is read-only:
  `Engine.runWithLock` builds it before `ensureRunDirs` and never
  mutates it again.

### 3.3 Process Registry (`process-registry.ts`) — IMPLEMENTED (FR-E25, FR-E60, FR-E61)

- **Status:** Implemented. FR-E25 + FR-E60 + FR-E61.
- **Purpose:** Track spawned `Deno.ChildProcess` instances and shutdown
  callbacks; enable graceful cleanup on `killAll()`. Two scoping modes
  coexist: a package-wide default singleton (back-compat with stand-alone
  CLI use) and instance-scoped `ProcessRegistry` instances supplied by
  embedding hosts (FR-E60).
- **Data:** `Set<Deno.ChildProcess>`, `Array<() => Promise<void> | void>`,
  configurable `graceMs` per instance — owned by `@korchasa/ai-ide-cli`.
  Engine's `process-registry.ts` only re-exports the `ProcessRegistry`
  class plus the default-singleton free functions
  (`register`/`unregister`/`onShutdown`/`killAll`).
- **Interfaces (instance-scoped):**
  - `new ProcessRegistry({ graceMs? })` — construct.
  - `register(p)` / `unregister(p)` — add/remove tracked process.
  - `onShutdown(cb): () => void` — register cleanup callback (returns
    disposer).
  - `killAll()` — SIGTERM all, wait `graceMs`, SIGKILL survivors, run
    callbacks.
- **Interfaces (free functions over default singleton):** Same names; they
  delegate to the package-wide default `ProcessRegistry` instance. Used by
  `Engine.run()` itself for its own `onShutdown(() => releaseLock(...))`
  hook so stand-alone CLI behavior is byte-for-byte identical.
- **Engine option flow (FR-E60):**
  `EngineOptions.processRegistry?` → `node-dispatch.ts` →
  `runAgent({...processRegistry})` / `handleAgentHitl({...})` /
  `runHitlLoop({...})` → forwarded to every `adapter.invoke()` call as
  `RuntimeInvokeOptions.processRegistry`. The ai-ide-cli adapters route
  spawned subprocesses to the supplied instance instead of the default.
  When the field is omitted at the top, every downstream invoke also sees
  `undefined` and the default singleton is used.
- **Signal handler boundary (FR-E61):** `installSignalHandlers()` lives in
  engine's local `process-registry.ts` and is exposed publicly, but it is
  NOT called by `Engine`. It exists exclusively for autonomous bin entry
  points (`cli.ts`, `scripts/self-runner.ts`). Embedding hosts own
  SIGINT/SIGTERM routing themselves and translate signals into
  queue-cancellation, not `Deno.exit`. Source-level invariant verified by
  `engine_test.ts::engine.ts does not import installSignalHandlers`.
- **Integration points:**
  - `agent.ts::runAgent` — forwards `processRegistry` to every
    `adapter.invoke()` (initial + continuation).
  - `engine.ts::Engine.run()` — `onShutdown(() => releaseLock(...))` for
    SIGINT/SIGTERM cleanup (default singleton); does NOT call
    `installSignalHandlers()`.
  - `cli.ts`, `self-runner.ts` — `installSignalHandlers()` at entry point
    (bin-mode only).
- **Design rationale:** The default singleton preserves bit-for-bit
  stand-alone CLI behavior. The opt-in `processRegistry` field gives
  embedding hosts a per-run kill scope — calling `killAll()` on the
  host's instance terminates only this engine's children, leaving any
  sibling subprocesses (chat dispatcher, scheduler, MCP server) intact.
  Signal wiring stays out of `Engine` so a host that already owns
  SIGINT/SIGTERM (most do — they translate signals into UI-level
  cancellation, not `Deno.exit`) is not blindsided by an engine call to
  `Deno.exit(130|143)`.

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


