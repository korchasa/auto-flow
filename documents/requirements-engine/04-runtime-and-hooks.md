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


