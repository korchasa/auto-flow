<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — Runtime, HITL, and Hooks

> Worktree isolation, isolation guardrail, branch-pin rescue, cwd-relative
> path contract, and per-workflow lock (FR-E24, FR-E50, FR-E51, FR-E52,
> FR-E54) live in [04b-worktree-isolation.md](04b-worktree-isolation.md).


### 3.2 FR-E2: Agent Log Storage

- **Description:** Every agent's full session transcript is stored for analysis and prompt improvement.

  **Log sources:**
  - **JSON output:** Claude CLI with `--output-format json` returns a structured JSON object with `result`, `session_id`, `total_cost_usd`, `duration_ms`, `duration_api_ms`, `num_turns`, `is_error`. This is captured by the stage script or engine.
  - **Normalized runtime output:** OpenCode JSON stream is normalized by the engine into the same `CliRunOutput`-compatible shape (`result`, `session_id`, `total_cost_usd`, `duration_ms`, `num_turns`, `is_error`) so downstream state, summary, continuation, and logging logic stay runtime-agnostic.
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

- **Description:** Workflow agents request human input mid-task through one
  cross-runtime mechanism: a stdio MCP server (engine-owned, named
  `flowai-workflow-hitl`) registered for the duration of each invocation
  exposes a single tool `request_human_input`. The engine intercepts the
  agent's call to that tool via the runtime-neutral `onToolUseObserved`
  hook (FR-L35 in `@korchasa/ai-ide-cli`), aborts the run with the
  question stashed, delegates question delivery and reply polling to
  external workflow scripts (`ask_script` / `check_script`), and resumes
  the agent session with the human's answer.

  **Mechanism (single path for every MCP-capable runtime):**
  1. Engine builds an `mcpServers` invoke option with one entry
     `flowai-workflow-hitl: { type: "stdio", command, args }` whenever
     `defaults.hitl` is configured AND the runtime adapter advertises
     `capabilities.mcpInjection === true` (Claude / OpenCode / Codex —
     Cursor warns and drops it).
  2. The library renders the entry into the runtime's native MCP
     plumbing — Claude `--mcp-config <tmp>`, OpenCode
     `OPENCODE_CONFIG_CONTENT`, Codex `--config mcp_servers.*`.
  3. Engine registers an `onToolUseObserved` callback that matches the
     runtime-prefixed tool name
     (`mcp__flowai-workflow-hitl__request_human_input` for Claude,
     `flowai-workflow-hitl_request_human_input` for OpenCode,
     `flowai-workflow-hitl.request_human_input` for Codex), normalises
     the input into `HumanInputRequest`, and returns `"abort"`.
  4. Engine extracts the captured question and the run's `session_id`.
  5. Engine invokes configurable `ask_script` to deliver the question
     (e.g., `gh issue comment`, Telegram bot).
  6. Engine enters poll loop: `sleep poll_interval` → invoke
     `check_script` → if exit 0 (reply found), read reply from stdout.
  7. Engine resumes the agent in the same session (re-injects the same
     `mcpServers` so nested HITL on resume is supported).

  **Key constraints:**
  - Engine contains zero GitHub/Slack/email-specific code. All
    delivery/polling logic lives in workflow scripts
    (`.flowai-workflow/<wf>/scripts/`).
  - Engine pattern-matches no runtime-native tool names except via the
    runtime-prefixed `request_human_input` derivation in
    `hitl-injection.ts::hitlToolNameFor`.
  - Workflow YAML and agent prompts MUST NOT mention
    `AskUserQuestion`, `request_human_input`, or any other
    runtime-specific HITL tool name (the agent discovers the tool
    from its runtime catalogue).
- **Decision:** hitl-via-engine-mcp.
- **Acceptance criteria:**
  - **Tests:** `hitl_test.ts`, `hitl-injection_test.ts`,
    `hitl-mcp-server_test.ts` (FR-E8; regression-locked;
    `markNodeWaiting`, ask/check script wiring, poll loop, timeout,
    resume on reply, auto-resume of `waiting` nodes, observer
    capture across runtimes, MCP server NDJSON handshake).
    See hitl-via-engine-mcp.
  - [x] Workflow scripts `hitl-ask.sh` and `hitl-check.sh` exist in
    `.flowai-workflow/<wf>/scripts/`. Evidence:
    `.flowai-workflow/github-inbox/scripts/hitl-ask.sh`,
    `.flowai-workflow/github-inbox/scripts/hitl-check.sh`.

### 3.64 FR-E64: HITL Q+A Audit Artefact

- **Description:** When a HITL round completes (reply received), the
  engine appends one line to `<nodeDirAbs>/hitl.jsonl` BEFORE invoking
  the resume call, where `<nodeDirAbs>` is `workPath(ctx.workDir,
  ctx.node_dir)`. Record shape:
  `{ts: ISO8601, round: number, question: HumanInputRequest, reply:
  string}`. Round counter is reconstructed from the existing line
  count of the file so resume after engine crash continues numbering
  correctly. Append is atomic on POSIX (single `Deno.writeTextFile`
  with `append: true, create: true`); ordering before resume
  guarantees the question survives a mid-resume crash for post-mortem.
- **Motivation:** Before FR-E64 the Q+A trail lived only inside the
  external transport's history (Telegram chat) and the agent's tool-use
  stream. Reconstructing the human-decision trail from `runs/<id>/`
  required scraping a third-party system. The audit artefact is the
  canonical, in-tree record used by post-mortem and dashboard tooling.
- **Decision:** hitl-via-engine-mcp.
- **Dep:** FR-E8.
- **Acceptance criteria:**
  - **Tests:** `hitl_test.ts` (FR-E64; regression-locked; reply-path
    audit append, multi-round counter, runDir tmp lifecycle).

### 3.75 FR-E75: Local HITL Answer Channel + Unified Command Layer

- **Description:** A transport-independent local channel that delivers a
  HITL reply to a waiting run from the same host the operator is already
  in (host IDE via MCP, or terminal via CLI), without impersonating the
  operator on the workflow's remote transport (e.g. Telegram). Two thin
  interfaces (MCP tool + CLI subcommand) sit over ONE shared core command
  module (`commands.ts`).

  **Local inbox file (channel):**
  - Path: `<runDir>/.hitl-inbox/<nodeId>.txt`, where `<runDir>` =
    `getRunDir(runId, workflowDir)`. Run-dir anchor (not the phased
    node-dir) keeps reader and writer in agreement with zero
    `PhaseRegistry`/worktree coupling. Lives under gitignored `runs/**`.
  - Content = reply text verbatim (mirrors the `check_script` stdout
    reply contract).
  - Written atomically: a sibling `<...>.txt.tmp` is written then
    `Deno.rename`d into place, so the live poll loop never reads a
    half-written file.

  **Reader precedence (poll loop):**
  - Each `runHitlLoop` iteration checks the inbox file BEFORE invoking
    `check_script`. On hit: read content, trim, atomically consume
    (`Deno.remove`), then run the existing reply→resume path (FR-E64
    audit append + session resume). Consume-on-pickup means a subsequent
    HITL round in the same session does NOT re-answer with the stale file.
  - Local inbox WINS over `check_script`: when both a file and a
    `check_script` reply are present in the same iteration, the inbox
    reply is used and `check_script` is not consulted that round.

  **`answer` command contract (write-only):**
  - `deliverHumanAnswer({workflowDir, runId, nodeId, text}) →
    {inboxPath, live}` validates the target node is in `waiting` status
    (replay the run journal; reject non-waiting / unknown node with a
    clear error — no silent fallback), writes the inbox file atomically,
    and reports engine liveness (`live`) from the per-workflow run lock.
    It NEVER resumes a dead engine and NEVER blocks. The caller resumes
    separately when `live === false`.
  - Target node is ALWAYS explicit (`--node` / `node_id`); there is no
    "single waiting node" auto-pick.

  **Unified command layer:**
  - `commands.ts` is the single construction site for an engine resume:
    `resumeRun({workflowDir, runId, verbosity?}) →
    {run_id, status, total_cost_usd}` builds `Engine({resume:true})` and
    runs it. The MCP `resume_node` tool and the CLI `run --resume` path
    both delegate here — no duplicated `new Engine({resume})`.
  - Two interfaces over the core:
    - MCP tool `provide_human_input {run_id, node_id, text}` →
      `deliverHumanAnswer` → `{inboxPath, live}`.
    - CLI `answer <workflow> <run-id> --node <id> "<text>"` →
      `deliverHumanAnswer` → prints `{inboxPath, live}`; on
      `live: false` hints to run resume separately.
- **Tasks:** documents/tasks/2026/05/local-hitl-answer-inbox.md.
- **Motivation:** When a workflow's `check_script` polls a remote
  transport (Telegram), a choice the operator makes locally in the host
  IDE never reaches the live engine — the run hangs healthy-but-blocked
  with no local mechanism to deliver the answer, and the agent must not
  forge a reply on the operator's behalf in the remote channel. A local
  file channel the live poll loop reads closes the gap while keeping the
  engine transport-agnostic.
- **Dep:** FR-E8, FR-E64, FR-E73.
- **Acceptance criteria:**
  - **Tests:** `state_test.ts`, `lock_test.ts`, `hitl_test.ts`,
    `commands_test.ts`, `mcp-server_test.ts`, `cli_test.ts` (FR-E75;
    regression-locked; inbox path helper, run-liveness probe, inbox
    pickup+consume+resume, inbox-wins-over-check precedence,
    `deliverHumanAnswer` waiting-validation + atomic write + liveness, MCP
    `provide_human_input` delivery, resume parity MCP↔core, `answer`
    argument parsing).

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



### 3.66 FR-E66: `{{bash()}}` Template Function

- **Description:** `template.ts` supports `{{bash("cmd")}}`. Engine spawns
  `bash -c "<cmd>"` synchronously with `cwd = workDir` (the worktree path
  during a run, falling back to `Deno.cwd()`), captures stdout, strips a
  single trailing `\n`, and substitutes the result at the call site.
  Non-zero exit throws with the captured stderr in the error message.
  Spawn failure (e.g., `bash` missing) throws with a descriptive prefix.
  Output is NOT re-interpolated. `validateTemplateVars` accepts any
  `bash("...")` payload — command syntax is not validated at load time
  (commands run at interpolation time only). Outer placeholder regex
  (`\{\{[^}]+\}\}`) forbids `}` and newlines inside the command; the
  inner regex (`bash\("(.+)"\)`) forbids embedded `"`. For complex
  scripts, place them in a file and call e.g. `{{bash("scripts/x.sh")}}`.
  Same >100 KB output warn threshold as `file()` / `flow_file()`.
- **Motivation:** Agents that need fresh environment-derived context
  (e.g., a QA agent reviewing the current `git diff`, file lists, or
  worktree state) had no way to obtain it through templates — only
  pre-staged file artefacts via `{{file()}}` / `{{flow_file()}}`.
  Forcing a separate `prepare_command` node for every dynamic snippet
  bloats the DAG. Inline shell substitution closes the gap with the
  same single-pass semantics as the existing file-include functions.
- **Dep:** FR-E32, FR-E55.
- **Acceptance criteria:**
  - **Tests:** `template_test.ts` (FR-E66; regression-locked;
    stdout substitution + trailing-newline trim, multi-line stdout
    preservation, cwd resolution, non-zero exit error path,
    no-re-interpolation guarantee, mix with other variables, large
    output warn threshold, validate-time pattern acceptance).

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



### 3.77 FR-E77: ACP as the Sole Runtime Transport

- **Description:** The engine drives every agent invocation over the Agent
  Client Protocol (ACP) transport shipped by `@korchasa/ai-ide-cli`
  (`^0.8.12`). ACP is implicit and non-configurable — there is NO workflow- or
  node-level `transport` knob, no cascade, and no `"cli"` fallback exposed to
  workflow authors. The package itself is multi-transport and defaults to
  `"cli"` when `RuntimeInvokeOptions.transport` is omitted, so the engine
  pins `transport: "acp"` explicitly at every call boundary to force the ACP
  front. `TransportOption = "cli" | "acp"` is re-exported from
  `@korchasa/ai-ide-cli/runtime/types`.

  **Transport pinning.**
  - `agent.ts:runAgent` sets `transport: "acp"` on both `adapter.invoke()`
    call sites — the initial invocation and the validation continuation /
    `--resume` — so the session stays on ACP for its lifetime.
  - `hitl.ts:runHitlLoop` sets `transport: "acp"` on the post-reply resume
    invocation.

  **Capability gating.** Because the package's CLI-baseline `adapter.capabilities`
  differs from the ACP vector, `agent.ts:runAgent`, `hitl.ts:runHitlLoop`, and
  `config.ts:validateRuntimeCompatibility` read capabilities through
  `adapter.capabilitiesFor("acp")` (falling back to `adapter.capabilities`
  only for test stubs that omit the method).
  - Runtime compatibility: `validateRuntimeCompatibility` calls
    `getRuntimeAdapter(resolvedRuntime).capabilitiesFor?.("acp")` inside a
    try block for every agent node. If the call throws (today: Cursor stays
    `pilot: false` in the package) OR `capabilitiesFor` is missing, config
    load fails with `Node '<id>': runtime '<runtime>' does not support ACP
    execution`. Caught at load time instead of at first invoke.
  - Tool-filter downgrade warning: when `allowed_tools` / `disallowed_tools`
    is declared at node or workflow-defaults level, the engine emits a
    one-shot warning via the `warnSink` callback — under ACP
    `capabilitiesFor("acp").toolFilter === false` for Claude / Codex /
    OpenCode, so the typed tool-filter fields are no-ops. Emission does NOT
    throw.
  - HITL MCP injection is gated on `effectiveCaps.mcpInjection`.

  **Ignored / unsupported under ACP — single reference.** Capability vector
  `@korchasa/ai-ide-cli@0.8.12` (FR-L39/L20/L42): Claude / Codex / OpenCode keep
  `permissionMode` + `mcpInjection` + `toolUseObservation` + `session` +
  `reasoningEffort` + `capabilityInventory` + `commandsFastChannel` true
  (HITL, effort, resume work); they downgrade `toolFilter` / `transcript` /
  `interactive` to false. Consequences:
  - `allowed_tools` / `disallowed_tools` (and raw `runtime_args`
    `--allowedTools` / `--disallowedTools` / `--tools`) — no-op on the wire;
    `validateRuntimeCompatibility` warns `… is ignored under ACP
    (toolFilter=false)`.
  - `runtime: cursor` — rejected at config-load (`capabilitiesFor("acp")`
    throws): `runtime 'cursor' does not support ACP execution`.
  - Per-node `<id>.jsonl` (the Claude-CLI transcript copied from
    `~/.claude/projects`, `state/log.ts`) — not produced (`transcript:
    false`); emits a `[log] JSONL transcript not found` warning. The stream
    log (`streamLogPath` / `onEvent`) is unaffected.
  - Session resume RESUMES since `0.8.11`: `^0.8.8` dropped
    `resumeSessionId` on ACP, so continuation / HITL resume silently
    started a fresh session. FR-L19 routes `session/load` when the front
    advertises `loadSession` (verified live: claude-agent-acp 0.37.0,
    opencode 1.16.2), else throws `AcpUnsupportedOptionError`.
  - `interactive` / `launchInteractive` — unsupported on ACP; never invoked
    during `run`.
  - `capabilityInventory` / `fetchCapabilitiesSlow` (ACP-routed since
    `0.8.11`, FR-L20) and `commandsFastChannel` / `fetchCommands` (ACP
    `available_commands_update`, FR-L42) — supported by the package,
    unused by the engine.
  - Removed knobs `defaults.transport` / `nodes.<id>.transport` — accepted
    but silently ignored (the schema validator does not reject unknown keys).
  Unaffected: `runtime` (claude / opencode / codex), `model`, `effort`,
  `permission_mode`, MCP injection, session / resume, `budget`, `validate`,
  `allowed_paths`, `memory_paths`.

- **Tasks:** [acp-transport-config](../tasks/2026/06/acp-transport-config.md).
- **Motivation:** the engine standardised on ACP as its only runtime
  transport. The earlier CLI-vs-ACP selection knob (`defaults.transport` /
  per-node `transport`, with cascade and a `--dry-run` suffix) was removed so
  workflows cannot pick a transport the engine no longer drives end-to-end;
  the engine consumes the external package's ACP front directly by pinning
  `transport: "acp"` rather than exposing a config option.
- **Dep:** FR-E2, FR-E8, FR-E48.
- **Acceptance criteria:**
  - **Tests:** `runtime_test.ts`, `config_test.ts`, `agent_runtime_test.ts`,
    `agent_test.ts`, `engine_test.ts`
    (FR-E77; regression-locked; ACP-support rejection at config load,
    tool-filter downgrade warning, `transport: "acp"` pinned on initial +
    resume, HITL capability gate consults `capabilitiesFor("acp")`).
  - [x] `@korchasa/ai-ide-cli` floor pinned `^0.8.12`. Evidence:
    `deno.json:10`.



### 3.81 FR-E81: Claude CLI Version Probe Gated on Runtime

- **Description:** The engine bootstraps each run by probing
  `claude --version` to capture the host CLI build into
  `RunState.claude_cli_version` and the journal (`run_metadata_updated`).
  That probe is gated on whether any agent node in the loaded workflow
  resolves (after defaults / loop-parent cascade) to `runtime: claude`.
  Codex-only and OpenCode-only workflows skip the probe entirely — no
  subprocess spawn, no `claude_cli_version` field, no
  "claude may not be on PATH" warning.

  **Detection:** `engine.ts:workflowUsesClaude(config)` walks
  `config.nodes` (including loop body nodes), evaluates
  `resolveRuntimeConfig({ defaults, node, parent })` per agent node, and
  short-circuits on the first claude hit. Pure function — exported for
  test access.

- **Motivation:** Codex-only workflows on hosts without the Claude CLI
  installed printed a misleading "claude may not be on PATH" warning
  and silently recorded an irrelevant `claude_cli_version` field when
  a stale binary lingered (e.g., the lumatale-fairy-taler bug-hunter
  run with `runtime: codex` for every node still wrote
  `claude_cli_version: "2.1.161 (Claude Code)"` to the journal).
  Probing a CLI the workflow never invokes leaks metadata and
  generates noise in journals consumed by the dashboard and post-run
  audit tooling.

- **Dep:** FR-E2.
- **Acceptance criteria:**
  - **Tests:** `engine_test.ts` (FR-E81; regression-locked; codex-only
    workflow, claude default, claude node override under codex default,
    claude inside loop body).



### 3.82 FR-E82: Fail-Fast on Runtime `is_error`

- **Description:** When the runtime adapter returns
  `RuntimeInvokeResult.output.is_error === true` from the INITIAL
  invocation of an agent node, the engine terminates the node
  immediately with `error_category` mapped from
  `result.error_category` (`stream_stall` passthrough, otherwise
  `cli_crash`). It does NOT enter the continuation /
  `--resume` loop even when validation rules are declared.

  **Rationale:** the continuation loop exists to recover from
  validation failures after a SUCCESSFUL run produced an artefact
  that fails a rule (file_exists, frontmatter_field, …). When the
  runtime itself terminated the turn (model rejection, API error,
  upstream 4xx), no artefact exists, the same prompt will fail the
  next attempt, and the loop multiplies the cost by
  `max_continuations × max_retries` per the resolved settings. The
  fail-fast gate caps the blast radius at a single attempt and
  surfaces the underlying error to the operator without burying it
  under N identical retries.

  **Cross-runtime contract:** any RuntimeAdapter setting
  `output.is_error === true` is treated as terminal here; permanent
  vs. transient classification is the adapter's responsibility via
  `RuntimeInvokeResult.error_category`. The pinned `@korchasa/ai-ide-cli`
  `^0.8.12` emits two typed categories: `"stream_stall"` and
  `"invalid_request"` (added `0.8.9`, FR-L41, permanent Codex HTTP 400s).
  `mapRuntimeErrorCategory` passes the former through and folds the rest
  into `"cli_crash"`; the fail-fast gate already stopped the node, so only
  journal category fidelity is lost. Engine code does NOT substring-match
  adapter error text. `runtime/error-types` (`ERROR_CATEGORY_*`) is absent
  from the published `exports` map, so the engine compares literals.

- **Tasks:** see the lumatale-fairy-taler bug-hunter remediation note
  (chat session 2026-06-04).
- **Motivation:** the lumatale bug-hunter run with the wrong Codex
  model (`gpt-5.3-codex`) emitted 22 identical
  `invalid_request_error` events across one node because the engine
  treated each `is_error: true` as a missing-artefact failure and
  drove `max_continuations: 8 × max_retries: 2` worth of resumes.
  The amplification cost real money and obscured the root cause.
- **Dep:** FR-E1, FR-E2.
- **Acceptance criteria:**
  - **Tests:** `agent_test.ts` (FR-E82; regression-locked; mock
    codex adapter returns `is_error: true`, runAgent returns
    `success: false`, `continuations: 0`, single invocation, mapped
    `error_category` non-`continuations_exhausted`).
