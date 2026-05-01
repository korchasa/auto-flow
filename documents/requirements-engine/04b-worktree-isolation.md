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
  - [x] `pre_run` field rejected with migration error at config validation. Evidence: `config.ts:220-224`
  - [x] `extractWorktreeDisabled(yaml)` extracts `defaults.worktree_disabled` without full parsing. Evidence: `config.ts:51-57`
  - [x] `worktree.ts` module: `createWorktree()`, `removeWorktree()`, `worktreeExists()`, `copyToOriginalRepo()`. Evidence: `worktree.ts`
  - [x] Engine creates worktree for new runs, reuses existing for resume, skips when `worktree_disabled: true`. Evidence: `engine.ts:120-136`
  - [x] `workPath()` utility centralizes workDir prefix logic. Evidence: `state.ts:126-128`
  - [x] All subprocess-spawning functions accept `cwd` parameter (agent, claude-process, hitl, validate, scope-check, loop). Evidence: `agent.ts`, `claude-process.ts`, `hitl.ts`, `validate.ts`, `scope-check.ts`, `loop.ts`
  - [x] Template `interpolate()` and config `validateFileReferences()` accept `workDir` for `{{file()}}` resolution. Evidence: `template.ts`, `config.ts`
  - [x] Tests: worktree lifecycle, path computation, error handling, config validation. Evidence: `worktree_test.ts`, `config_test.ts`



### 3.50 FR-E50: Worktree Isolation Guardrail

- **Description:** When a workflow runs under worktree isolation
  (`workDir !== "."`), the engine snapshots the main repo's working tree
  before each agent invocation and verifies after the invocation that no
  files were modified outside `<workDir>/` and outside the node's
  `allowed_paths`. Any leak triggers `markNodeFailed(error_category:
  "scope_violation")` and an automatic `git checkout --` rollback of
  exactly the leaked paths. Complements FR-E37 (which checks `allowed_paths`
  inside the worktree) by guarding the dual: writes outside the worktree.
- **ADR:** [documents/adrs/0001-isolation-provider.md](../adrs/0001-isolation-provider.md)
  (planned — the guardrail is a worktree-provider concern; rationale will
  carry forward when the provider plugin lands).
- **Motivation:** Even after FR-E48/b0db7e6 fixed the cwd-relative template
  path emission, an LLM agent may still decide to write to absolute paths
  for other reasons (e.g., misreading prompts, prior training artifacts,
  inferred conventions). Two real incidents observed: this repo issue #196
  v3 (4 memory files leaked into main) and `kazar-fairy-taler` (developer
  memory + accidental gitlink). The guardrail converts silent corruption
  of main into immediate, attributable node failure.
- **Constraints:**
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
- **Acceptance criteria:**
  - [x] Engine snapshots main repo tree before and after every agent
    invocation when `workDir !== "."`. Evidence: `guardrail.ts:186-209`
    (`runWithGuardrail` wraps with snapshot before/after); wired in
    `node-dispatch.ts:113-141`.
  - [x] Difference (after − before), filtered by NOT-prefixed-by `<workDir>/`
    and NOT-matching `node.allowed_paths`, is treated as leaked paths.
    Evidence: `guardrail.ts:34-49` (`detectLeaks`).
  - [x] Non-empty leak triggers `markNodeFailed` with
    `error_category: "scope_violation"`. Evidence: `node-dispatch.ts:143-151`.
  - [x] Engine runs `git checkout -- <leaked-paths>` (per-path, not bulk)
    to restore main. Evidence: `guardrail.ts:116-142` (`rollbackLeaks`).
  - [x] `workDir === "."` mode is a no-op (no snapshot, no overhead).
    Evidence: `guardrail.ts:190-192` (early return); test
    `guardrail_integration_test.ts:148`.
  - [x] Fail-closed: snapshot or rollback failure marks node failed with
    explicit error message. Evidence: `guardrail.ts:91-97` throws on git
    failure; the throw propagates from `runWithGuardrail` and the node's
    catch block in `engine.ts:523-528` calls `markNodeFailed` with
    `error_category: "unknown"`.
  - [x] Output: default verbosity prints
    `[guardrail] node=<id> leaked <N> file(s): <list> (rolled back)`.
    Evidence: `guardrail.ts:55-62` (`formatLeakMessage`); test
    `guardrail_integration_test.ts:184-213`.
  - [x] Unit test: pure `detectLeaks` covers whitelist (workDir prefix,
    allowed_paths globs), pre-existing modifications, untracked, modified.
    Evidence: `guardrail_test.ts` (8 cases for `detectLeaks`/`globMatch`).
  - [x] Integration test: exercises full guardrail flow against a temp git
    repo with mocked agent. Evidence:
    `guardrail_integration_test.ts:39-243` (8 cases including
    rollback-scope, fail-when-leaked, noop-when-disabled, log-format,
    allowedPaths whitelist).
  - [x] E2E test: `e2e_worktree_isolation_test.ts` runs a fake agent that
    writes outside workDir; main is restored, node fails. Evidence:
    `e2e_worktree_isolation_test.ts:136-186` (abs-path leak scenario).
  - [x] `deno task check` passes. Evidence: `deno task check` (PASS, 787 tests).

### 3.51 FR-E51: Post-Run Branch-Pin for Detached-HEAD Worktree

- **ADR:** [documents/adrs/0004-detached-head-rescue-branch.md](../adrs/0004-detached-head-rescue-branch.md)
- **Description:** Before `removeWorktree`, the engine checks whether the
  worktree's HEAD is detached. If yes, it creates a rescue branch
  `flowai/run-<runId>-orphan-rescue` pointing at the current HEAD so the
  commits made in the worktree remain reachable after the worktree is
  removed. If a branch with that name already exists (resume of the same
  run-id, repeat invocation), the engine appends a counter suffix
  (`-2`, `-3`, …) until it finds a free name. No-op when HEAD is already
  on a named branch.
- **Motivation:** Worktrees are created with `--detach` (FR-E24) so they
  don't pollute the main repo's branch namespace. If a workflow makes
  commits in the worktree but never explicitly checks out a branch, those
  commits are reachable only via the worktree's `HEAD` ref. Once the
  worktree is removed, the commits become unreachable and are eligible for
  garbage collection — the `kazar-fairy-taler` incident lost three commits
  this way (`be9bb6a → 12e6e93 → f6f6b94`) before manual rescue.
- **Constraints:**
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
- **Acceptance criteria:**
  - [x] Engine calls `pinDetachedHead(workDir, runId)` immediately before
    every `removeWorktree(workDir)` invocation. Evidence:
    `engine.ts:303-321`.
  - [x] On detached HEAD: branch `flowai/run-<runId>-orphan-rescue` is
    created at HEAD; the branch name is returned. Evidence:
    `worktree.ts:108-140`; tests `worktree_test.ts:198-224`,
    `worktree_test.ts:273-302`.
  - [x] On HEAD already on a named branch: no branch is created; function
    returns `undefined`. Evidence: `worktree.ts:112-117`; test
    `worktree_test.ts:226-250`.
  - [x] On existing rescue-branch name: function appends `-2`, `-3`, … and
    creates the first free name; returns that name. Evidence:
    `worktree.ts:119-128`; test `worktree_test.ts:252-271`.
  - [x] `workDir === "."` mode: function is not invoked (engine guards).
    Evidence: `engine.ts:294` (`if (this.workDir !== ".")`).
  - [x] Rescue branch creation logged via `output.status("engine", …)` at
    default verbosity, including branch name and worktree path. Evidence:
    `engine.ts:311-316`.
  - [x] Unit tests cover detached / on-branch / counter-conflict paths.
    Evidence: `worktree_test.ts:198-302` (4 cases) + E2E
    `e2e_worktree_isolation_test.ts:188-225`.
  - [x] `deno task check` passes. Evidence: `deno task check` (PASS, 787 tests).

### 3.52 FR-E52: Cwd-Relative Path Contract for TemplateContext

- **ADR:** [documents/adrs/0005-cwd-relative-template-paths.md](../adrs/0005-cwd-relative-template-paths.md)
- **Description:** All path fields in `TemplateContext` (`node_dir`,
  `run_dir`, `input.<id>`) are emitted **workDir-relative** by the engine
  (FR-E7 / fix `b0db7e6`). Engine-internal consumers that perform FS I/O
  from the engine process (whose cwd is the main repo root) MUST wrap
  these paths via `workPath(ctx.workDir, …)` before access. Template
  rendering (`template.ts`) is the sole legitimate raw consumer — emitted
  values reach subprocess prompts whose cwd is `workDir`, where the
  workDir-relative form is correctly resolved.
- **Motivation:** Cross-references FR-E7. The Variant A fix (`b0db7e6`)
  established the contract; FR-E52 enumerates ALL consumers, fixes the
  remaining bug (`resolveInputArtifacts` read via raw paths from engine
  cwd → silent empty verbose-input listings under worktree mode), and
  installs a regression-guard test so the next consumer added cannot
  silently violate the contract.
- **Constraints:**
  - Engine cwd is repo root for the entire run; never `chdir`.
  - `template.ts` is the only allowed bare-emission site — anywhere else
    that touches `ctx.node_dir` / `ctx.run_dir` outside `workPath(…)`
    fails the audit test.
  - Subprocess invocations (`Deno.Command(..., { cwd: workDir })`) and
    template-rendered shell commands do NOT need wrapping — their working
    directory aligns with workDir.
- **Acceptance criteria:**
  - [x] `agent.ts::resolveInputArtifacts` accepts `workDir` and wraps
    `inputs[id]` before `Deno.readDir`. Default value `"."` preserves
    backwards-compatibility for callers in no-worktree mode. Evidence:
    `agent.ts:43-68`.
  - [x] Caller `node-dispatch.ts::executeAgentNode` passes `eng.workDir`.
    Evidence: `node-dispatch.ts:105`.
  - [x] Audit test (`template_paths_test.ts::FR-E52 — bare ctx.node_dir /
    ctx.run_dir restricted to template.ts`) scans every non-test root-level
    `*.ts` source file; fails CI if any line outside `template.ts`
    references `ctx.node_dir` / `ctx.run_dir` without a `workPath`
    wrapper on the same line. Evidence: `template_paths_test.ts:141-184`.
  - [x] Audit confirms all current consumers in `loop.ts`, `human.ts`,
    `hitl-handler.ts`, `node-dispatch.ts`, `engine.ts` wrap correctly.
    Evidence: audit test passes — see `template_paths_test.ts:141-184`
    (assertEquals offenders to []).
  - [x] `validate.ts::runSingleValidation` wraps interpolated rule paths
    via `workPath(ctx.workDir, …)` before `Deno.stat` / `readTextFile`,
    and emits workDir-relative `displayPath` in messages so agent sees
    paths writable from cwd = workDir. Closes a contract gap: the audit
    regex catches direct `ctx.node_dir` references but not indirect
    references via `interpolate(rule.path, ctx)`, which validate.ts
    used. Mismatch with `extractConditionValue` (already wrapped) caused
    `Loop 'implementation': condition_field 'verdict' not found` on
    `github-inbox` run `20260501T020329` (issue #196). Evidence:
    `validate.ts:53-87`, regression tests
    `validate_test.ts::FR-E52 — file_exists under worktree wraps path with workDir`
    and `validate_test.ts::FR-E52 — artifact + frontmatter_field under worktree wrap path`.
  - [x] `deno task check` passes. Evidence: `deno task check` (PASS, 820 tests).

### 3.54 FR-E54: Per-Workflow Run Lock

- **ADR:** [documents/adrs/0006-per-workflow-run-lock.md](../adrs/0006-per-workflow-run-lock.md)
- **Description:** The workflow lock file is rooted at `<workflowDir>/runs/.lock`,
  not at the repo-global `.flowai-workflow/runs/.lock`. `<workflowDir>` is the
  folder that contains `workflow.yaml` (FR-S47, FR-E53). The engine derives it
  once via `deriveWorkflowDir(options.config_path)` and threads it into
  `defaultLockPath(workflowDir)`. Two runs against the **same** workflow folder
  serialize as before; runs against **different** workflow folders proceed in
  parallel because they hold independent lock files.
- **Motivation:** Multi-workflow layouts under `.flowai-workflow/` (e.g.,
  `github-inbox/`, `github-inbox-opencode/`, `github-inbox-opencode-test/`)
  are first-class since FR-S47/FR-E53. The pre-existing single repo-global
  lock falsely serialized them, blocking parallel dogfood smoke runs and
  cross-workflow experimentation. Lock scope must align with the actual
  isolation boundary — the workflow folder, which already owns its `runs/`
  and state namespaces (per-run worktrees nest under `runs/<run-id>/worktree/`,
  FR-E57).
- **Constraints:**
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
- **Acceptance criteria:**
  - [x] `defaultLockPath(workflowDir)` returns `<workflowDir>/runs/.lock`.
    Evidence: `lock.ts:22-24`.
  - [x] `Engine.run()` resolves the lock path via
    `defaultLockPath(this.workflowDir)` (override
    `options.lock_path` still respected). Evidence: `engine.ts:191-193`.
  - [x] Two `acquireLock` calls against **distinct** workflow dirs both
    succeed concurrently. Evidence: `lock_test.ts` ("acquireLock — distinct
    workflow dirs hold independent locks (FR-E54)").
  - [x] Two `acquireLock` calls against the **same** workflow dir still
    refuse the second when the first holder PID is alive (FR-E25 carry-over).
    Evidence: `lock_test.ts` ("acquireLock — same workflow dir still
    serializes (FR-E54 carry-over of FR-E25)") and pre-existing
    "acquireLock — fails if same-host live process holds lock".
  - [x] `EngineOptions.lock_path` JSDoc reflects the new default
    (`<workflowDir>/runs/.lock`). Evidence: `types.ts:405-407`.
  - [x] `deno task check` passes.

### 3.55 FR-E57: Per-Run Worktree Co-Location

- **ADR:** [documents/adrs/0003-per-run-worktree-co-location.md](../adrs/0003-per-run-worktree-co-location.md)
- **Description:** Each run's git worktree is materialized at
  `<workflowDir>/runs/<run-id>/worktree/`, sibling to its `state.json` and
  per-node artifact directories. Replaces the pre-FR-E57 repo-global
  `.flowai-workflow/worktrees/<run-id>/` location. `<workflowDir>` is the
  folder containing `workflow.yaml` (FR-S47, FR-E53). The engine derives it
  once via `deriveWorkflowDir(options.config_path)` and threads it into
  `getWorktreePath(runId, workflowDir)`, `createWorktree(runId, workflowDir,
  ref?)`, and `worktreeExists(runId, workflowDir)`.
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
- **Constraints:**
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
- **Acceptance criteria:**
  - [x] `getWorktreePath(runId, workflowDir)` returns
    `<workflowDir>/runs/<run-id>/worktree`. Old single-arg signature
    removed. Evidence: `worktree.ts:31-33`. Test:
    `worktree_test.ts::getWorktreePath — returns
    <workflowDir>/runs/<runId>/worktree (FR-E57)`.
  - [x] `createWorktree(runId, workflowDir, ref?)` materializes the
    worktree at the path returned by `getWorktreePath` and ensures the
    parent `<workflowDir>/runs/<run-id>/` directory exists before
    invoking `git worktree add`. Evidence: `worktree.ts:46-66`. Test:
    `worktree_test.ts::worktree lifecycle — create, exists, remove
    (FR-E57 layout)`.
  - [x] `worktreeExists(runId, workflowDir)` returns true iff the FR-E57
    `<workflowDir>/runs/<run-id>/worktree/` directory exists. Evidence:
    `worktree.ts:117-119`. Tests:
    `worktree_test.ts::worktreeExists — returns false for non-existent
    worktree (FR-E57)` and `worktreeExists — returns true when FR-E57
    directory exists`.
  - [x] `Engine.run()` invokes `createWorktree(runId, this.workflowDir)`
    and uses `resolveExistingWorktreePath(runId, this.workflowDir)` for
    resume. Evidence: `engine.ts:144-173`.
  - [x] `Engine.run()` rejects a worktree-mode run when
    `workflowDir === "."` with an error referencing FR-S47/FR-E53.
    Evidence: `engine.ts:144-153`. Test: `engine_test.ts::Engine.run() —
    rejects worktree mode when workflow.yaml is at repo root (FR-E57)`.
  - [x] `removeWorktree(path)` calls `git worktree prune` after the
    primary remove. Evidence: `worktree.ts:91-97`. Test:
    `worktree_test.ts::removeWorktree — prunes stale gitlink after
    manual dir removal (FR-E57)`.
  - [x] Two distinct `workflowDir` values hold worktrees at disjoint
    filesystem paths; concurrent runs across workflow folders do not
    collide. Evidence: `worktree.ts:31-33`. Tests:
    `worktree_test.ts::createWorktree — distinct workflow dirs hold
    independent worktrees (FR-E57)` and
    `e2e_worktree_isolation_test.ts::e2e — distinct workflow dirs hold
    independent worktrees (FR-E57)`.
  - [x] `deno task check` passes (798 tests, 0 failures).



### 3.58 FR-E58: Copy Gitignored Files into Run Worktree

- **ADR:** [documents/adrs/0001-isolation-provider.md](../adrs/0001-isolation-provider.md)
  (planned — the gitignored-file mirror is a worktree-provider concern;
  rationale will carry forward when the provider plugin lands).
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
- **Motivation:** Workflows often need files outside git — `.env`,
  `node_modules`, `.venv`, local caches. A fresh `git worktree add`
  ref-checkout has none of them, so agents fail with «missing
  dependency» errors that look like workflow bugs. Unconditional copy
  makes the worktree a faithful working-state clone outside git's
  tracking universe.
- **Constraints:** No-op when `worktree_disabled: true`; no-op on resume
  reuse (re-copy would clobber the previous run's persisted state under
  ignored paths). Errors on regular files/dirs/symlinks are fail-fast —
  existing teardown cleans the worktree. Physical byte duplication is a
  deliberate cost of the cross-platform Deno-only constraint; revisit if
  a real workflow hits the limit.
- **Acceptance criteria:**
  - [x] `worktree.ts` exports `copyIgnoredIntoWorktree(workDir, output,
    origRepo?): Promise<{files: number; bytes: number}>`. Evidence:
    `worktree.ts`.
  - [x] Function classifies each entry via `Deno.lstat` and dispatches:
    symlink → `readLink`+`symlink`, file → `copyFile`, directory →
    `mkdir`+recurse via `readDir`. Parent dirs auto-created. Evidence:
    `worktree.ts` (`classifyAndCopy`).
  - [x] Special files emit `output.warn` and are skipped. Evidence:
    `worktree.ts` (`classifyAndCopy` final branch).
  - [x] Progress: leading `Copying ignored files...`, per-top-level
    `Copied <path>: <N> files, <S>` (B/KB/MB/GB formatter), trailing
    `Ignored files copied: <N_total> files, <S_total>` — all via
    `output.status("engine", …)`. Evidence: `worktree.ts`
    (`copyIgnoredIntoWorktree`), `worktree_copy_ignored_test.ts`
    (progress-lines test).
  - [x] Engine calls it after `createWorktree`; skipped on
    `worktree_disabled` and resume-reuse paths. Evidence: `engine.ts`
    (new-run branch in worktree setup).
  - [x] Self-copy guard: when `workDir` itself appears under an ignored
    ancestor in `origRepo` (e.g. `<workflowDir>/runs/` matched by
    gitignore `runs/`), `git ls-files --directory` collapses the
    ancestor into a single ignored entry. The recursive walk skips the
    destination worktree on `resolve(src) === absWorkDir`, preventing
    the worktree from being copied into itself until `ENAMETOOLONG`.
    Sibling prior-run leftovers under the same ancestor still mirror.
    Evidence: `worktree.ts` (`classifyAndCopy` head guard),
    `worktree_copy_ignored_test.ts` (`does not recurse into workDir`
    regression test).
  - [x] Untracked-not-ignored paths NOT copied (unit test verifies).
    Evidence: `worktree_copy_ignored_test.ts` (untracked-not-ignored test).
  - [x] Unit tests cover: file, directory recursion, live symlink,
    broken symlink, untracked-vs-ignored filter, counters, tracked-file
    non-overwrite, empty-repo zero-result. Evidence:
    `worktree_copy_ignored_test.ts` (8 tests).
  - [ ] `deno task check` passes.
