<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — Runtime, HITL, and Hooks


### 3.2 FR-E2: Agent Log Storage

- **Description:** Every agent's full session transcript is stored for analysis and prompt improvement.
- **Log sources:**
  - **JSON output:** Claude CLI with `--output-format json` returns a structured JSON object with `result`, `session_id`, `total_cost_usd`, `duration_ms`, `duration_api_ms`, `num_turns`, `is_error`. This is captured by the stage script or engine.
  - **Normalized runtime output:** OpenCode JSON stream is normalized by the engine into the same `CliRunOutput`-compatible shape (`result`, `session_id`, `total_cost_usd`, `duration_ms`, `num_turns`, `is_error`, optional `hitl_request`) so downstream state, summary, continuation, and logging logic stay runtime-agnostic.
  - **JSONL transcript:** Claude CLI automatically stores full session transcripts as JSONL files in `~/.claude/projects/`. Each line is a JSON event (messages, tool calls, responses).
- **Acceptance criteria (legacy shell script path):**
  - Each stage script saves two log files:
    - `.flowai-workflow/workflow/<issue-number>/logs/stage-<N>-<role>.json` — the JSON output from `claude` CLI (metadata: cost, duration, session ID, result).
    - `.flowai-workflow/workflow/<issue-number>/logs/stage-<N>-<role>.jsonl` — copy of the JSONL transcript from `~/.claude/projects/` for the session.
  - Logs are committed to the feature branch after each stage.
  - Stage script locates the JSONL transcript by session ID extracted from the JSON output.
- **Acceptance criteria (Deno engine path):**
  - [x] After each non-loop agent node completes successfully, the engine saves a JSON log to `.flowai-workflow/runs/<run-id>/logs/` and, for Claude runtime only, copies the JSONL transcript:
    - `<node-id>.json` — full `CliRunOutput` JSON object (`result`, `session_id`, `total_cost_usd`, `duration_ms`, `duration_api_ms`, `num_turns`, `is_error`).
    - `<node-id>.jsonl` — Claude-only copy of the JSONL session transcript from `~/.claude/projects/<project-hash>/`, located by matching `session_id` in filenames.
    - Evidence: `engine.ts:266-270`, `log.ts`
  - [x] If the Claude JSONL transcript file is not found: engine logs a warning and continues — workflow does NOT fail. Evidence: `log.ts`
  - [x] Loop body nodes (developer, qa) must have logs saved after each iteration. Log files use iteration-qualified names: `<node-id>-iter-<N>.json` and `<node-id>-iter-<N>.jsonl`. `runLoop()` calls `saveAgentLog()` for each body node after successful completion. Evidence: `engine.ts:574-582` (onNodeComplete callback in executeLoopNode saves logs using `${id}-iter-${iteration}` node ID)
  - [x] `LoopResult` includes per-iteration `AgentResult` references (with `CliRunOutput`) to enable log extraction by the engine. Evidence: `loop.ts:18-26` (`LoopResult.bodyResults: AgentResult[]`), `loop.ts:69,99` (initialized, pushed per body node per iteration)
  - [x] Log-saving logic has unit tests covering: successful save, JSONL-not-found warning path. Evidence: `log_test.ts:29-124` (5 tests)



### 3.8 FR-E8: Human-in-the-Loop (Agent-Initiated)

- **Description:** Workflow agents can request human input mid-task through a runtime-specific structured signal. Claude uses the built-in `AskUserQuestion` tool (visible in headless mode as `permission_denials`). OpenCode uses a per-invocation local MCP tool injected by the engine through `OPENCODE_CONFIG_CONTENT`. In both cases the engine normalizes the request, delegates question delivery and reply polling to external workflow scripts, and resumes the agent session with the human's answer.
- **Mechanism:**
  1. Claude path: agent calls `AskUserQuestion` → Claude CLI denies it in `-p` mode (no terminal) → structured question visible in `permission_denials`.
  2. OpenCode path: engine injects a local MCP server exposing `request_human_input` via `OPENCODE_CONFIG_CONTENT` → runtime emits structured `tool_use` event for `hitl_request_human_input`.
  3. Engine extracts question (`{question, header, options[], multiSelect}`) and `session_id`.
  4. Engine invokes configurable `ask_script` (workflow script, not engine code) to deliver question (e.g., `gh issue comment`).
  5. Engine enters poll loop: `sleep poll_interval` → invoke `check_script` → if exit 0 (reply found), read reply from stdout.
  6. Engine resumes agent in the same session (`claude --resume <session_id>` or `opencode run --session <session_id>`). Agent continues with full session context.
- **Key constraint:** Engine contains zero GitHub/Slack/email-specific code. All delivery/polling logic lives in workflow scripts (`.flowai-workflow/scripts/`).
- **Acceptance criteria:**
  - [x] Engine detects runtime-native HITL requests after agent node completes: Claude via `permission_denials`, OpenCode via normalized `tool_use` parsing from `opencode run --format json`. Evidence: `hitl.ts` (`detectHitlRequest()`), `opencode-process.ts` (`extractOpenCodeOutput()`), `node-dispatch.ts` (call in `executeAgentNode`)
  - [x] Engine saves `session_id`, question JSON, and node status `waiting` to `state.json`. Evidence: `state.ts:93-103` (`markNodeWaiting()`), `engine.ts:324-325` (call + saveState), `types.ts:104` (`question_json` field)
  - [x] Engine invokes `ask_script` (path from `workflow.yaml` `defaults.hitl`) with args: `--run-dir`, `--artifact-source`, `--run-id`, `--node-id`, `--question-json`. Evidence: `hitl.ts:111-125` (`buildScriptArgs("ask")`), `hitl.ts:127-134` (ask invocation)
  - [x] Engine enters poll loop calling `check_script` with args: `--run-dir`, `--artifact-source`, `--run-id`, `--node-id`, `--exclude-login`. Exit 0 = reply in stdout; exit 1 = no reply yet. Evidence: `hitl.ts:137-175` (poll loop), `hitl_test.ts:184-214` (poll test)
  - [x] On reply: engine resumes agent via the selected runtime's session-resume mechanism. Claude uses `--resume`; OpenCode uses `run --session`. Evidence: `hitl.ts` (`adapter.invoke()` with `resumeSessionId`), `agent.ts`, `opencode-process.ts`
  - [x] Configurable `poll_interval` (default 60s) and `timeout` (default 7200s) per workflow. Evidence: `types.ts:170-175` (`HitlConfig`), `.flowai-workflow/workflow.yaml:16-20` (defaults.hitl)
  - [x] On timeout: node fails, Meta-Agent triggered. Evidence: `hitl.ts:183-188` (timeout return), `engine.ts:342-347` (markNodeFailed on HITL failure), `hitl_test.ts:216-230` (timeout test)
  - [x] `deno task run` on a workflow with `waiting` nodes auto-resumes polling (no manual `--resume` needed). Evidence: `engine.ts:278-310` (wasWaiting resume path in executeAgentNode)
  - [x] Workflow scripts `hitl-ask.sh` and `hitl-check.sh` exist in `.flowai-workflow/scripts/`. Evidence: `.flowai-workflow/scripts/hitl-ask.sh`, `.flowai-workflow/scripts/hitl-check.sh`
  - [x] `hitl-ask.sh` renders question JSON → markdown with HTML marker `<!-- hitl:<run-id>:<node-id> -->`, posts via `gh issue comment`. Evidence: `.flowai-workflow/scripts/hitl-ask.sh:52-76` (markdown render + marker + gh post)
  - [x] `hitl-check.sh` finds first non-bot comment after marker, outputs body to stdout (exit 0) or exits 1 if no reply. Evidence: `.flowai-workflow/scripts/hitl-check.sh:39-54` (jq filter + exit codes)



### 3.19 FR-E19: Generic Workflow Failure Hook (`on_failure_script`)

- **Description:** Engine supports a configurable `on_failure_script` field in `WorkflowDefaults` (YAML: `defaults.on_failure_script`). When the workflow fails, the engine executes the specified script via `Deno.Command`. Replaces the former hard-wired `rollbackUncommitted()` git call, which violated the domain-agnostic invariant (FR-E14).
- **Rationale:** Domain-specific failure recovery (e.g., git rollback) belongs in workflow scripts, not engine code. The engine provides a generic hook; the workflow wires it to the appropriate script.
- **Acceptance criteria:**
  - [x] `WorkflowDefaults` in `types.ts` includes `on_failure_script?: string`. Evidence: `types.ts:23` (`on_failure_script?: string`)
  - [x] Engine executes `on_failure_script` via `Deno.Command` on workflow failure (if configured). Evidence: `engine.ts:171-175` (`runFailureHook` called when `!workflowSuccess`), `engine.ts:808-831` (`runFailureHook` using `new Deno.Command(script, ...)`)
  - [x] Engine does NOT import or call any git functions on failure. Evidence: `engine.ts` — no git imports; failure path uses generic `runFailureHook` only
  - [x] `.flowai-workflow/workflow.yaml` sets `on_failure_script: .flowai-workflow/scripts/rollback-uncommitted.sh`. Evidence: `.flowai-workflow/workflow.yaml:18` (`on_failure_script: .flowai-workflow/scripts/rollback-uncommitted.sh`)
  - [x] If script path not found: engine logs warning and continues (no hard failure). Evidence: `engine.ts:828-829` (catch block logs warning, does not throw)
  - [x] Unit test covers `on_failure_script` execution path. Evidence: `engine_test.ts:776-822` (4 `runFailureHook` tests: no-op, success, script failure, nonexistent script)
  - [x] `deno task check` passes. Evidence: 490 passed, 0 failed



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



### 3.31 FR-E31: Stale Path Reference Cleanup in Engine Artifacts

- **Description:** Engine documentation and test fixtures must be free of deprecated `.flowai-workflow/` path references and hardcoded `.flowai-workflow/agents/agent-*` paths. Physical migration to `.flowai-workflow/` completed in #111; ~30 stale `.flowai-workflow/` refs remain in `requirements-engine.md` evidence fields, ~12 in `design-engine.md`, and engine test fixtures reference `.flowai-workflow/agents/agent-*` paths.
- **Motivation:** Stale path references in evidence fields cause navigation failures (paths no longer exist), undermine documentation trustworthiness, and create onboarding confusion. Test fixtures with hardcoded `.flowai-workflow/agents/agent-*` paths are brittle if symlinks change.
- **Acceptance criteria:**
  - [ ] Zero `.flowai-workflow/` path references in `documents/requirements-engine.md`. Evidence: grep result = 0.
  - [ ] Zero `.flowai-workflow/` path references in `documents/design-engine.md`. Evidence: grep result = 0.
  - [ ] Zero `.flowai-workflow/agents/agent-*` hardcoded path references in `documents/requirements-engine.md`. Evidence: grep result = 0.
  - [ ] Engine test fixtures (`hitl_test.ts`, `agent_test.ts`, `config_test.ts`, `workflow_integrity_test.ts`) use `.flowai-workflow/agents/` paths only. Evidence: file contents.
  - [ ] `deno task check` passes. Evidence: `deno task check` exit 0.



### 3.32 FR-E32: `{{file()}}` Template Function

- **Description:** Template engine (`template.ts`) supports `{{file("path/to/file.md")}}` function syntax. Reads named file content and inserts it inline at the call site. Paths resolved relative to repo root. Inserted content NOT re-interpolated (prevents recursion, ensures predictable behavior). Fail-fast: throws descriptive error if file not found.
- **Motivation:** Two separate mechanisms for file content injection (`prompt` field via `--system-prompt-file`; `task_template` via `{{variable}}` substitution) prevent composition of shared instructions across nodes without duplication. `{{file()}}` unifies inline file injection into the existing template system.
- **Acceptance criteria:**
  - [x] `{{file("path")}}` resolves path relative to repo root and inserts
    file content inline.
  - [x] Inserted content is NOT re-interpolated (no nested `{{...}}`
    processing of included text).
  - [x] Missing file throws a fail-fast error with the missing path in the
    message.
  - [x] `deno task check` validates `{{file()}}` references at load time by
    executing real file reads.
  - [x] Validation error identifies the missing file path for quick diagnosis.
  - [x] Size warning emitted when included file content exceeds a threshold.
  - [x] Unit tests: successful inclusion, missing file error, no
    re-interpolation of included content.
  - [x] Config check tests: `deno task check` catches missing `{{file()}}`
    path in `task_template`.



### 3.40 FR-E40: Permission Mode Configuration

- **Description:** First-class `permission_mode` field in `WorkflowDefaults` and
  `NodeConfig` that maps to Claude Code's `--permission-mode` CLI flag. Replaces
  raw `--dangerously-skip-permissions` in `runtime_args`. Supported values:
  `acceptEdits`, `bypassPermissions`, `default`, `dontAsk`, `plan`, `auto`.
  Per-node override cascades: node → defaults → omit. Config validation rejects
  invalid values.
- **Motivation:** Declarative, type-safe permission control. Eliminates raw CLI
  arg strings, enables per-node granularity, validates at config load time.
- **Acceptance criteria:**
  - [x] AC1: `PermissionMode` type and `permission_mode` field on
    `WorkflowDefaults` + `NodeConfig`. Evidence: `types.ts:9-24,55,90`.
  - [x] AC2: `buildClaudeArgs()` emits `--permission-mode <value>` when set.
    Evidence: `claude-process.ts:88-90`.
  - [x] AC3: Config validation rejects invalid values. Evidence:
    `config.ts:138-149`; `config_test.ts` (invalid mode tests).
  - [x] AC4: `claude_args` field removed in favor of universal `runtime_args`.
  - [x] AC5: Per-node override resolution (node → defaults → omit) in
    `node-dispatch.ts` and `loop.ts`. Evidence: `node-dispatch.ts:54`,
    `loop.ts:93-94`.
  - [x] AC6: `deno task check` green: 590 tests, 0 failures.



### 3.48 FR-E48: Node Tool Filtering

- **Description:** First-class `allowed_tools` (whitelist) and
  `disallowed_tools` (blacklist) fields on `WorkflowDefaults` and
  `NodeConfig`. Cascade resolution is **replace**-semantics:
  node → enclosing loop → defaults — the first level that declares either
  field wins entirely. Fields are mutually exclusive at the same level.
  Conflict detection rejects coexistence with raw
  `--allowedTools`/`--allowed-tools`/`--disallowedTools`/`--disallowed-tools`/`--tools`
  in the same level's `runtime_args`. Resolved values flow as typed
  `allowedTools`/`disallowedTools` fields on `RuntimeInvokeOptions`;
  Claude adapter emits `--allowedTools` / `--disallowedTools` CLI flags,
  other adapters warn once and no-op (per FR-L24 in `@korchasa/ai-ide-cli`).
  Flags are sent on both initial and resume (continuation) invocations.
- **Motivation:** Operators need declarative, type-safe control over the
  tool surface each agent can touch, without hand-crafting raw CLI strings
  in `runtime_args`. Typed fields enable config-time validation, stable
  introspection, and uniform mapping across IDEs via the library adapter
  layer.
- **Acceptance criteria:**
  - [x] AC1: `allowed_tools?: string[]` and `disallowed_tools?: string[]`
    declared on `WorkflowDefaults` and `NodeConfig`. Evidence:
    `types.ts:101-104`, `types.ts:200-203`.
  - [x] AC2: Per-level validation — array of non-empty strings, mutex at
    the same level, reserved-keys conflict with `runtime_args`. Evidence:
    `config.ts:632-698` (`TOOL_FILTER_RESERVED_KEYS`,
    `validateToolFilterLevel`, `validateToolFilterField`).
  - [x] AC3: Cascade resolver `resolveToolFilter(node, defaults, loopParent)`
    implements replace-semantics, node → loopParent → defaults. Evidence:
    `config.ts:722-745`.
  - [x] AC4: Engine wires resolved filter into `RuntimeInvokeOptions` on
    both initial and resume invocations. Evidence:
    `agent.ts:219-220,328-329`, `node-dispatch.ts:92-93,115-116,164-165`,
    `loop.ts:195-196`, `hitl.ts:259-260`.
  - [x] AC5: Runtime-specific emission of `--allowedTools` /
    `--disallowedTools` handled by the library adapter (Claude), not by
    engine. Non-Claude runtimes warn and ignore per FR-L24. Engine code
    contains no runtime-specific tool-flag logic beyond the typed field
    pass-through.
  - [x] AC6: Unit tests — validation (array, mutex, reserved-keys ×3,
    back-compat, cross-level mode switch), resolver (node/loop/defaults
    priority, empty cascade, mode switch), wiring (mock adapter captures
    fields on initial and resume, mutex guard). Evidence:
    `config_test.ts` (tests `parseConfig — allowed_tools …`,
    `resolveToolFilter — …`), `agent_tool_filter_test.ts`.
  - [x] AC7: `deno task check` green (fmt + lint + type-check + tests +
    doc-lint + publish dry-run).



### 3.49 FR-E49: CLI Auto-Update Prevention for Spawned Processes

- **Description:** The engine always sets `DISABLE_AUTOUPDATER=1` in the
  environment of every Claude CLI subprocess it spawns (initial invocation,
  continuation, resume). Prevents Claude CLI auto-update between node
  invocations within a single run, guaranteeing all agent nodes use the same
  CLI version. The engine also captures `claude --version` once at run start
  and stores it in `RunState` for observability.
- **Motivation:** Claude CLI may silently self-upgrade between invocations. In
  a long-running workflow with multiple agent nodes, earlier nodes could run on
  version X and later on version Y — different system prompts, different tool
  descriptions, no operator visibility. `DISABLE_AUTOUPDATER=1` is a
  startup-only env var exposed by Claude Code that reliably prevents this.
- **Constraints:**
  - Engine always sets this — no YAML opt-out. Baseline safety.
  - Applies only to engine-spawned processes, not the operator's own CLI.
  - Must not break existing env passthrough (user env + engine-specific vars).
  - Must be set on every spawn path: initial invocation, continuation, resume.
- **Acceptance criteria:**
  - [ ] `buildSpawnEnv()` in `claude-process.ts` always sets `DISABLE_AUTOUPDATER=1`.
  - [ ] Applied on initial invocation, continuation, and resume spawn paths.
  - [ ] `RunState` includes `claude_cli_version?: string` field.
  - [ ] Engine captures `claude --version` once at run start; stores in `RunState.claude_cli_version`.
  - [ ] Unit test: `buildSpawnEnv()` returns env containing `DISABLE_AUTOUPDATER=1` regardless of process env.
  - [ ] Unit test: user-provided env merged but `DISABLE_AUTOUPDATER=1` always wins.
  - [ ] `deno task check` passes.



### 3.50 FR-E50: Worktree Isolation Guardrail

- **Description:** When a workflow runs under worktree isolation
  (`workDir !== "."`), the engine snapshots the main repo's working tree
  before each agent invocation and verifies after the invocation that no
  files were modified outside `<workDir>/` and outside the node's
  `allowed_paths`. Any leak triggers `markNodeFailed(error_category:
  "scope_violation")` and an automatic `git checkout --` rollback of
  exactly the leaked paths. Complements FR-E37 (which checks `allowed_paths`
  inside the worktree) by guarding the dual: writes outside the worktree.
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
  - [x] `deno task check` passes. Evidence: `deno task check` (PASS, 787 tests).
