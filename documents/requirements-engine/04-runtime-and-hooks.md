<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — Runtime, HITL, and Hooks

> Worktree isolation, isolation guardrail, branch-pin rescue, cwd-relative
> path contract, and per-workflow lock (FR-E24, FR-E50, FR-E51, FR-E52,
> FR-E54) live in [04b-worktree-isolation.md](04b-worktree-isolation.md).


### 3.2 FR-E2: Agent Log Storage

- **Description:** Every agent's full session transcript is stored for analysis and prompt improvement.

  **Log sources:**
  - **JSON output:** Claude CLI with `--output-format json` returns a structured JSON object with `result`, `session_id`, `total_cost_usd`, `duration_ms`, `duration_api_ms`, `num_turns`, `is_error`. This is captured by the stage script or engine.
  - **Normalized runtime output:** OpenCode JSON stream is normalized by the engine into the same `CliRunOutput`-compatible shape (`result`, `session_id`, `total_cost_usd`, `duration_ms`, `num_turns`, `is_error`, optional `hitl_request`) so downstream state, summary, continuation, and logging logic stay runtime-agnostic.
  - **JSONL transcript:** Claude CLI automatically stores full session transcripts as JSONL files in `~/.claude/projects/`. Each line is a JSON event (messages, tool calls, responses).

  **Legacy shell-script storage (deprecated):**
  - Each stage script saves two log files:
    - `.flowai-workflow/workflow/<issue-number>/logs/stage-<N>-<role>.json` — the JSON output from `claude` CLI (metadata: cost, duration, session ID, result).
    - `.flowai-workflow/workflow/<issue-number>/logs/stage-<N>-<role>.jsonl` — copy of the JSONL transcript from `~/.claude/projects/` for the session.
  - Logs are committed to the feature branch after each stage.
  - Stage script locates the JSONL transcript by session ID extracted from the JSON output.
- **Acceptance criteria:**
  - **Tests:** `log_test.ts` (regression-locked; successful save,
    JSONL-not-found warning path, iteration-qualified loop body
    log names).



### 3.8 FR-E8: Human-in-the-Loop (Agent-Initiated)

- **Description:** Workflow agents can request human input mid-task through a runtime-specific structured signal. Claude uses the built-in `AskUserQuestion` tool (visible in headless mode as `permission_denials`). OpenCode uses a per-invocation local MCP tool injected by the engine through `OPENCODE_CONFIG_CONTENT`. In both cases the engine normalizes the request, delegates question delivery and reply polling to external workflow scripts, and resumes the agent session with the human's answer.

  **Mechanism:**
  1. Claude path: agent calls `AskUserQuestion` → Claude CLI denies it in `-p` mode (no terminal) → structured question visible in `permission_denials`.
  2. OpenCode path: engine injects a local MCP server exposing `request_human_input` via `OPENCODE_CONFIG_CONTENT` → runtime emits structured `tool_use` event for `hitl_request_human_input`.
  3. Engine extracts question (`{question, header, options[], multiSelect}`) and `session_id`.
  4. Engine invokes configurable `ask_script` (workflow script, not engine code) to deliver question (e.g., `gh issue comment`).
  5. Engine enters poll loop: `sleep poll_interval` → invoke `check_script` → if exit 0 (reply found), read reply from stdout.
  6. Engine resumes agent in the same session (`claude --resume <session_id>` or `opencode run --session <session_id>`). Agent continues with full session context.

  **Key constraint:** Engine contains zero GitHub/Slack/email-specific code. All delivery/polling logic lives in workflow scripts (`.flowai-workflow/scripts/`).
- **Acceptance criteria:**
  - **Tests:** `hitl_test.ts` (regression-locked; detection,
    `markNodeWaiting`, ask/check script wiring, poll loop, timeout,
    resume on reply, auto-resume of `waiting` nodes).
  - [x] Workflow scripts `hitl-ask.sh` and `hitl-check.sh` exist in
    `.flowai-workflow/scripts/`. Evidence:
    `.flowai-workflow/scripts/hitl-ask.sh`,
    `.flowai-workflow/scripts/hitl-check.sh`.
  - [x] `hitl-ask.sh` renders question JSON → markdown with HTML
    marker `<!-- hitl:<run-id>:<node-id> -->`, posts via `gh issue
    comment`. Evidence: `.flowai-workflow/scripts/hitl-ask.sh:52-76`.
  - [x] `hitl-check.sh` finds first non-bot comment after marker,
    outputs body to stdout (exit 0) or exits 1 if no reply.
    Evidence: `.flowai-workflow/scripts/hitl-check.sh:39-54`.



### 3.19 FR-E19: Generic Workflow Failure Hook (`on_failure_script`)

- **Description:** Engine supports a configurable `on_failure_script` field in `WorkflowDefaults` (YAML: `defaults.on_failure_script`). When the workflow fails, the engine executes the specified script via `Deno.Command`. Replaces the former hard-wired `rollbackUncommitted()` git call, which violated the domain-agnostic invariant (FR-E14).
- **Motivation:** Domain-specific failure recovery (e.g., git rollback) belongs in workflow scripts, not engine code. The engine provides a generic hook; the workflow wires it to the appropriate script.
- **Acceptance criteria:**
  - **Tests:** `engine_test.ts` (FR-E19; regression-locked; no-op,
    success path, script failure warning, nonexistent script).
  - [x] `.flowai-workflow/workflow.yaml` sets `on_failure_script:
    .flowai-workflow/scripts/rollback-uncommitted.sh`. Evidence:
    `.flowai-workflow/workflow.yaml:18`.
  - [x] Engine does NOT import or call any git functions on failure.
    Evidence: `engine.ts` — no git imports.




### 3.31 FR-E31: Stale Path Reference Cleanup in Engine Artifacts

- **Description:** Engine documentation and test fixtures must be free of deprecated `.flowai-workflow/` path references and hardcoded `.flowai-workflow/agents/agent-*` paths. Physical migration to `.flowai-workflow/` completed in #111; ~30 stale `.flowai-workflow/` refs remain in `requirements-engine.md` evidence fields, ~12 in `design-engine.md`, and engine test fixtures reference `.flowai-workflow/agents/agent-*` paths.
- **Motivation:** Stale path references in evidence fields cause navigation failures (paths no longer exist), undermine documentation trustworthiness, and create onboarding confusion. Test fixtures with hardcoded `.flowai-workflow/agents/agent-*` paths are brittle if symlinks change.
- **Acceptance criteria:**
  - [x] Cleanup complete — zero deprecated path references in
    `documents/requirements-engine.md`, `documents/design-engine.md`,
    or engine test fixtures (`hitl_test.ts`, `config_test.ts`,
    `agent_test.ts`). Evidence: `grep -c` = 0 across all targets
    (`workflow_integrity_test.ts` no longer exists; constraint moot).



### 3.32 FR-E32: `{{file()}}` Template Function

- **Description:** Template engine (`template.ts`) supports `{{file("path/to/file.md")}}` function syntax. Reads named file content and inserts it inline at the call site. Paths resolved relative to repo root. Inserted content NOT re-interpolated (prevents recursion, ensures predictable behavior). Fail-fast: throws descriptive error if file not found.
- **Motivation:** Two separate mechanisms for file content injection (`prompt` field via `--system-prompt-file`; `task_template` via `{{variable}}` substitution) prevent composition of shared instructions across nodes without duplication. `{{file()}}` unifies inline file injection into the existing template system.
- **Acceptance criteria:**
  - **Tests:** `template_test.ts`, `config_test.ts` (FR-E32;
    regression-locked; resolution, no re-interpolation, missing-file
    error, size warning, load-time validation).



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
  - **Tests:** `config_test.ts` (regression-locked; invalid-mode
    rejection, per-node override cascade). Library-side flag
    emission covered by `@korchasa/ai-ide-cli` tests.
  - [x] `claude_args` field removed in favor of universal
    `runtime_args`. Evidence: code grep — no `claude_args`
    references in engine source.



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
  - **Tests:** `config_test.ts`, `agent_tool_filter_test.ts` (FR-E48;
    regression-locked; field validation, mutex, reserved-keys
    conflicts, cascade resolver, wiring on initial + resume).



### 3.49 FR-E49: CLI Auto-Update Prevention for Spawned Processes

- **Description:** The engine always sets `DISABLE_AUTOUPDATER=1` in the
  environment of every Claude CLI subprocess it spawns (initial invocation,
  continuation, resume). Prevents Claude CLI auto-update between node
  invocations within a single run, guaranteeing all agent nodes use the same
  CLI version. The engine also captures `claude --version` once at run start
  and stores it in `RunState` for observability.

  **Constraints:**
  - Engine always sets this — no YAML opt-out. Baseline safety.
  - Applies only to engine-spawned processes, not the operator's own CLI.
  - Must not break existing env passthrough (user env + engine-specific vars).
  - Must be set on every spawn path: initial invocation, continuation, resume.
- **Motivation:** Claude CLI may silently self-upgrade between invocations. In
  a long-running workflow with multiple agent nodes, earlier nodes could run on
  version X and later on version Y — different system prompts, different tool
  descriptions, no operator visibility. `DISABLE_AUTOUPDATER=1` is a
  startup-only env var exposed by Claude Code that reliably prevents this.
- **Acceptance criteria:**
  - [ ] `buildSpawnEnv()` in `claude-process.ts` always sets `DISABLE_AUTOUPDATER=1`.
  - [ ] Applied on initial invocation, continuation, and resume spawn paths.
  - [ ] `RunState` includes `claude_cli_version?: string` field.
  - [ ] Engine captures `claude --version` once at run start; stores in `RunState.claude_cli_version`.
  - [ ] Unit test: `buildSpawnEnv()` returns env containing `DISABLE_AUTOUPDATER=1` regardless of process env.
  - [ ] Unit test: user-provided env merged but `DISABLE_AUTOUPDATER=1` always wins.
  - [ ] `deno task check` passes.



### 3.55 FR-E55: `{{flow_file()}}` Template Function

- **Description:** `template.ts` supports `{{flow_file("path")}}` like `{{file()}}`
  but resolves paths relative to the workflow directory
  (`workDir/dirname(config_path)`). Single-pass; fail-fast on miss.
  `validateFileReferences` covers both patterns at load time.
- **Motivation:** Workflow folders co-exist under `.flowai-workflow/<wf>/`; assets
  (agents, partials) live inside. `file()` forces hardcoded folder prefix —
  rename breaks all prompts. `flow_file()` decouples prompts from folder name.
- **Acceptance criteria:**
  - **Tests:** `template_test.ts`, `config_test.ts` (regression-locked;
    `flow_file()` resolution against `workflow_dir`, no
    re-interpolation, absolute-path bypass, missing-file error,
    `validateFileReferences` accepts both patterns).

