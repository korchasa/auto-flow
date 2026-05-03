<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — Worktree Isolation & Per-Workflow Lock

Run-isolation primitives: per-run git worktree (FR-E24), main-tree leak
guardrail (FR-E50), detached-HEAD rescue branch (FR-E51), cwd-relative
template path contract (FR-E52), and the per-workflow run lock (FR-E54).



### 3.24 FR-E24: Worktree Isolation (replaces pre_run)

- **Description:** ~~Pre-run script (`pre_run`)~~ **Superseded.** Engine now
  creates a git worktree per run for execution isolation, eliminating destructive
  `git reset --hard`. Two-phase loading: (1) read raw YAML, extract
  `defaults.worktree_disabled`; (2) if not disabled, create worktree from
  `origin/main`; (3) load full config from worktree. All subprocesses, file I/O,
  and template `{{file()}}` resolution use the worktree path (`cwd`/`workDir`).
  On success, worktree removed; on failure, preserved for `--resume`. State
  copied to original repo before cleanup.
- **Motivation:** `pre_run` relied on destructive git operations that could lose
  work. Worktree isolation provides clean execution environment without modifying
  the original working tree.
- **Acceptance criteria:**
  - **Tests:** `worktree_test.ts`, `config_test.ts` (regression-locked;
    worktree lifecycle, `pre_run` migration rejection, `worktree_disabled`
    flag, path computation).
  - [x] `worktree.ts` exports `createWorktree()`, `removeWorktree()`,
    `worktreeExists()`, `copyToOriginalRepo()`. Evidence: `worktree.ts`.
  - [x] `workPath()` utility centralizes workDir prefix logic.
    Evidence: `state.ts:126-128`.
  - [x] All subprocess-spawning functions accept `cwd` parameter
    (agent, claude-process, hitl, validate, scope-check, loop).
    Evidence: `agent.ts`, `claude-process.ts`, `hitl.ts`, `validate.ts`,
    `scope-check.ts`, `loop.ts`.
  - [x] Template `interpolate()` and config `validateFileReferences()`
    accept `workDir` for `{{file()}}` resolution. Evidence:
    `template.ts`, `config.ts`.



### 3.50 FR-E50: Worktree Isolation Guardrail

- **Description:** When a workflow runs under worktree isolation
  (`workDir !== "."`), the engine snapshots the main repo's working tree
  before each agent invocation and verifies after the invocation that no
  files were modified outside `<workDir>/` and outside the node's
  `allowed_paths`. Any leak triggers `markNodeFailed(error_category:
  "scope_violation")` and an automatic `git checkout --` rollback of
  exactly the leaked paths. Complements FR-E37 (which checks `allowed_paths`
  inside the worktree) by guarding the dual: writes outside the worktree.

  **Constraints:**
  - No-op when `workDir === "."` (no worktree); behavior identical to
    pre-feature.
  - `git status --porcelain` snapshot uses
    `-c status.showUntrackedFiles=normal` to override user-global config.
  - Fail-CLOSED on git failure (snapshot/rollback): mark node failed with
    explicit message rather than silently skipping.
  - Rollback scope = exactly the leaked paths (`git checkout -- <paths>`),
    NOT `git checkout -- .` — preserves any user work-in-progress.
  - No external deps.
  - Whitelist of legitimate cross-workdir actions: `git push`, `git
    checkout` inside worktree, read-only access to main. The guardrail
    sees only working-tree changes, so refs and reads pass through.
- **Motivation:** Even after FR-E48/b0db7e6 fixed the cwd-relative template
  path emission, an LLM agent may still decide to write to absolute paths
  for other reasons (e.g., misreading prompts, prior training artifacts,
  inferred conventions). Two real incidents observed: this repo issue #196
  v3 (4 memory files leaked into main) and `kazar-fairy-taler` (developer
  memory + accidental gitlink). The guardrail converts silent corruption
  of main into immediate, attributable node failure.
- **ADR:** [documents/adrs/0001-isolation-provider.md](../adrs/0001-isolation-provider.md)
  (planned — the guardrail is a worktree-provider concern; rationale will
  carry forward when the provider plugin lands).
- **Acceptance criteria:**
  - **Tests:** `guardrail_test.ts`, `guardrail_integration_test.ts`,
    `e2e_worktree_isolation_test.ts` (FR-E50; regression-locked).

### 3.51 FR-E51: Post-Run Branch-Pin for Detached-HEAD Worktree

- **Description:** Before `removeWorktree`, the engine checks whether the
  worktree's HEAD is detached. If yes, it creates a rescue branch
  `flowai/run-<runId>-orphan-rescue` pointing at the current HEAD so the
  commits made in the worktree remain reachable after the worktree is
  removed. If a branch with that name already exists (resume of the same
  run-id, repeat invocation), the engine appends a counter suffix
  (`-2`, `-3`, …) until it finds a free name. No-op when HEAD is already
  on a named branch.

  **Constraints:**
  - No-op when `workDir === "."` (engine never invokes worktree teardown).
  - No-op when HEAD is on a named branch — the typical path through a
    `decision`-like agent that explicitly checks out a branch is
    untouched.
  - Branch creation uses `git branch <name> HEAD` — non-destructive,
    cannot overwrite existing branches.
  - Failure to pin is reported via `output.warn` but does NOT block
    worktree removal — the rescue is best-effort. (Rationale: a mid-run
    crash or corrupted ref shouldn't prevent cleanup.)
  - User notification at default verbosity: `engine` status line
    `Detached HEAD pinned: branch=<name> worktree=<path>`.
- **Motivation:** Worktrees are created with `--detach` (FR-E24) so they
  don't pollute the main repo's branch namespace. If a workflow makes
  commits in the worktree but never explicitly checks out a branch, those
  commits are reachable only via the worktree's `HEAD` ref. Once the
  worktree is removed, the commits become unreachable and are eligible for
  garbage collection — the `kazar-fairy-taler` incident lost three commits
  this way (`be9bb6a → 12e6e93 → f6f6b94`) before manual rescue.
- **ADR:** [documents/adrs/0004-detached-head-rescue-branch.md](../adrs/0004-detached-head-rescue-branch.md)
- **Acceptance criteria:**
  - **Tests:** `worktree_test.ts`, `e2e_worktree_isolation_test.ts`
    (FR-E51; regression-locked).
  - [x] Engine calls `pinDetachedHead(workDir, runId)` immediately before
    every `removeWorktree(workDir)` invocation. Evidence:
    `engine.ts:303-321`.

### 3.52 FR-E52: Cwd-Relative Path Contract for TemplateContext

- **Description:** All path fields in `TemplateContext` (`node_dir`,
  `run_dir`, `input.<id>`) are emitted **workDir-relative** by the engine
  (FR-E7 / fix `b0db7e6`). Engine-internal consumers that perform FS I/O
  from the engine process (whose cwd is the main repo root) MUST wrap
  these paths via `workPath(ctx.workDir, …)` before access. Template
  rendering (`template.ts`) is the sole legitimate raw consumer — emitted
  values reach subprocess prompts whose cwd is `workDir`, where the
  workDir-relative form is correctly resolved.

  **Constraints:**
  - Engine cwd is repo root for the entire run; never `chdir`.
  - `template.ts` is the only allowed bare-emission site — anywhere else
    that touches `ctx.node_dir` / `ctx.run_dir` outside `workPath(…)`
    fails the audit test.
  - Subprocess invocations (`Deno.Command(..., { cwd: workDir })`) and
    template-rendered shell commands do NOT need wrapping — their working
    directory aligns with workDir.
- **Motivation:** Cross-references FR-E7. The Variant A fix (`b0db7e6`)
  established the contract; FR-E52 enumerates ALL consumers, fixes the
  remaining bug (`resolveInputArtifacts` read via raw paths from engine
  cwd → silent empty verbose-input listings under worktree mode), and
  installs a regression-guard test so the next consumer added cannot
  silently violate the contract.
- **ADR:** [documents/adrs/0005-cwd-relative-template-paths.md](../adrs/0005-cwd-relative-template-paths.md)
- **Acceptance criteria:**
  - **Tests:** `template_paths_test.ts`, `validate_test.ts` (FR-E52;
    regression-locked). The `template_paths_test.ts` audit case is
    a build-time guard — failing CI on any new bare `ctx.node_dir` /
    `ctx.run_dir` reference outside `template.ts`.

### 3.54 FR-E54: Per-Workflow Run Lock

- **Description:** The workflow lock file is rooted at `<workflowDir>/runs/.lock`,
  not at the repo-global `.flowai-workflow/runs/.lock`. `<workflowDir>` is the
  folder that contains `workflow.yaml` (FR-S47, FR-E53). The engine derives it
  once via `deriveWorkflowDir(options.config_path)` and threads it into
  `defaultLockPath(workflowDir)`. Two runs against the **same** workflow folder
  serialize as before; runs against **different** workflow folders proceed in
  parallel because they hold independent lock files.

  **Constraints:**
  - Lock path is purely a function of `workflowDir`; no fallback to the
    legacy global path. Stale `.flowai-workflow/runs/.lock` from older
    binaries is ignored (orphan file, not consulted).
  - Same-workflow-folder semantics unchanged: PID-based liveness check,
    stale-lock reclaim on dead PID, hostname stored for diagnostics only
    (FR-E25 invariants preserved).
  - `EngineOptions.lock_path` override (test-only) still wins when set —
    no auto-derivation when explicit.
  - **Worktree namespace was NOT yet per-workflow at FR-E54 time.** Code
    used a repo-global `WORKTREE_BASE = ".flowai-workflow/worktrees"`,
    so two distinct workflow folders running concurrently would have
    collided in that one path. FR-E57 closes the gap by relocating
    worktrees to `<workflowDir>/runs/<run-id>/worktree/` — see §3.55.
- **Motivation:** Multi-workflow layouts under `.flowai-workflow/` (e.g.,
  `github-inbox/`, `github-inbox-opencode/`, `github-inbox-opencode-test/`)
  are first-class since FR-S47/FR-E53. The pre-existing single repo-global
  lock falsely serialized them, blocking parallel dogfood smoke runs and
  cross-workflow experimentation. Lock scope must align with the actual
  isolation boundary — the workflow folder, which already owns its `runs/`
  and state namespaces (per-run worktrees nest under `runs/<run-id>/worktree/`,
  FR-E57).
- **ADR:** [documents/adrs/0006-per-workflow-run-lock.md](../adrs/0006-per-workflow-run-lock.md)
- **Acceptance criteria:**
  - **Tests:** `lock_test.ts` (FR-E54; regression-locked).
  - [x] `EngineOptions.lock_path` JSDoc reflects the new default
    (`<workflowDir>/runs/.lock`). Evidence: `types.ts:405-407`.

### 3.55 FR-E57: Per-Run Worktree Co-Location

- **Description:** Each run's git worktree is materialized at
  `<workflowDir>/runs/<run-id>/worktree/`, sibling to its `state.json` and
  per-node artifact directories. Replaces the pre-FR-E57 repo-global
  `.flowai-workflow/worktrees/<run-id>/` location. `<workflowDir>` is the
  folder containing `workflow.yaml` (FR-S47, FR-E53). The engine derives it
  once via `deriveWorkflowDir(options.config_path)` and threads it into
  `getWorktreePath(runId, workflowDir)`, `createWorktree(runId, workflowDir,
  ref?)`, and `worktreeExists(runId, workflowDir)`.

  **Constraints:**
  - `worktree_disabled: true` mode (workDir = "."): all `workflowDir`-aware
    calls become no-ops. Existing semantics preserved.
  - **Fail-fast when `workflowDir === "."` and worktree mode is active.**
    `deriveWorkflowDir` returns `"."` when `workflow.yaml` is passed
    without a directory prefix (legacy back-compat for callers predating
    FR-S47/FR-E53). Under FR-E57 that would put the worktree at
    `./runs/<run-id>/worktree`, not covered by `.gitignore`. The engine
    refuses this combination at run start with a message naming
    FR-S47/FR-E53. Users must either pass a `workflow.yaml` inside a
    workflow folder or set `worktree_disabled: true`.
  - **Cleanup hygiene.** `removeWorktree(path)` calls `git worktree prune`
    after a successful `git worktree remove --force` (errors swallowed —
    idempotent). Prevents stale gitlinks from blocking later removal of
    the parent `runs/<run-id>/` directory.
  - **`git worktree add` writes an absolute gitdir path into the
    worktree's `.git` file.** Existing worktrees are never relocated by
    this change — only new worktrees adopt the new layout.
  - Engine remains domain-agnostic. Path computation is parametrized by
    `workflowDir`; no SDLC- or git-workflow-specific knowledge added.
- **Motivation:**
  - **Self-contained run directory:** A single path
    `<workflowDir>/runs/<run-id>/` now contains everything tied to a run
    (state, artifacts, live worktree). Inspection, archival, and bulk
    cleanup operate on one tree.
  - **Cross-workflow worktree namespace:** FR-E54 already split runs and
    locks per workflow folder, but `worktree.ts` kept a repo-global
    `WORKTREE_BASE = ".flowai-workflow/worktrees"`. Two distinct workflow
    folders running concurrently would have collided in that single
    namespace. FR-E57 closes the gap so cross-workflow parallel runs are
    fully isolated.
  - **Doc/code alignment:** `documents/requirements-engine/04b-...md:223`
    (FR-E54 constraints) already asserted the worktree directory was
    "already per-workflow" — that was aspirational. FR-E57 makes it true.
- **ADR:** [documents/adrs/0003-per-run-worktree-co-location.md](../adrs/0003-per-run-worktree-co-location.md)
- **Acceptance criteria:**
  - **Tests:** `worktree_test.ts`, `engine_test.ts`,
    `e2e_worktree_isolation_test.ts` (FR-E57; regression-locked).



### 3.58 FR-E58: Copy Gitignored Files into Run Worktree

- **Description:** After `createWorktree()` and before any node executes,
  the engine mirrors gitignored entries from the original repo into the
  worktree at the same relative paths. Source list:
  `git ls-files --others --ignored --exclude-standard --directory -z` in
  the original repo. Copy is unconditional (no allowlist, no size limit),
  uses Deno FS APIs only (cross-platform; no shell `cp`, no
  reflink/clonefile). Symlinks preserved as symlinks (target verbatim,
  broken symlinks reproduced). Tracked files untouched (already present
  from `origin/main` checkout). Untracked-not-ignored NOT copied —
  committing/stashing them remains operator's job (FR-E50 safety check).
  Special files (socket/FIFO/device) skipped with a warning.

  **Constraints:** No-op when `worktree_disabled: true`; no-op on resume
  reuse (re-copy would clobber the previous run's persisted state under
  ignored paths). Errors on regular files/dirs/symlinks are fail-fast —
  existing teardown cleans the worktree. Physical byte duplication is a
  deliberate cost of the cross-platform Deno-only constraint; revisit if
  a real workflow hits the limit.

  **Skip-prefix guard:** the recursive walk rejects any source path equal
  to (or under) one of two roots: the destination worktree itself
  (prevents self-copy when `workDir` lives under an ignored ancestor in
  `origRepo`) and `<workflowDir>/runs/` (engine's runtime state — sibling
  worktrees of other live runs plus their per-run `state.json`/artefacts).
  Without the second guard, each prior live worktree carries its own
  mirrored `runs/` snapshot, producing exponentially-nested
  `runs/<id>/worktree/.flowai-workflow/<wf>/runs/<id>/worktree/…` trees
  that quickly hit `ENAMETOOLONG`. Ignored paths OUTSIDE the engine's
  `runs/` root mirror normally.
- **Motivation:** Workflows often need files outside git — `.env`,
  `node_modules`, `.venv`, local caches. A fresh `git worktree add`
  ref-checkout has none of them, so agents fail with «missing
  dependency» errors that look like workflow bugs. Unconditional copy
  makes the worktree a faithful working-state clone outside git's
  tracking universe.
- **ADR:** [documents/adrs/0001-isolation-provider.md](../adrs/0001-isolation-provider.md)
  (planned — the gitignored-file mirror is a worktree-provider concern;
  rationale will carry forward when the provider plugin lands).
- **Acceptance criteria:**
  - **Tests:** `worktree_copy_ignored_test.ts` (regression-locked;
    `copyIgnoredIntoWorktree` covers files, dir recursion, symlinks
    (live + broken), untracked-vs-ignored filter, tracked-file
    non-overwrite, self-copy guard, runs-root skip with `workflowDir`
    excluding nested-worktree mirrors, empty-repo zero-result, progress
    lines).
