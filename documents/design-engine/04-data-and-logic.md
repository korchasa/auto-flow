<!-- section file — index: [documents/design-engine.md](../design-engine.md) -->

# SDS Engine — Data, Logic, Non-Functional, Constraints


## 4. Data

- **Entities:**
  - Run Journal: JSONL (`<workflow>/runs/<run-id>/journal.jsonl`). Append-only
    recovery contract; replay derives `RunState` from empty memory (FR-E69).
  - Pipeline Config: YAML (`.flowai-workflow/workflow.yaml`). Top-level keys: `name`,
    `version`, `defaults`, `phases`, `nodes`. `phases` key declares
    named phase groups with member stage IDs. Engine treats `phases` as opaque
    config data. `defaults.prepare_command` (FR-E30): optional string, shell
    command executed post-config/pre-node with template interpolation
    (supports `{{run_dir}}`, `{{run_id}}`, `{{env.*}}`, `{{args.*}}` only).
  - ValidationRule: `{ type: "file_exists"|"file_not_empty"|"contains_section"|
    "custom_script"|"frontmatter_field"|"artifact"|"git_worktree_clean"|
    "git_default_branch_checked_out"|"git_no_unpushed_commits", path?,
    field?, allowed?, sections?: string[], fields?: string[], ... }` — when
    `type === "artifact"`: at least one of `sections` or `fields` required
    (FR-E33, FR-E38). `fields` = frontmatter field names for presence-only
    checks. Git repository-state rules are parameterless (FR-E67)
  - LoopResult: `{ ..., bodyResults: AgentResult[] }` — accumulated per-iteration
    agent results; consumed by `executeLoopNode()` callback for log saving
  - LoopNodeConfig: `{ ..., nodes: Record<string, NodeConfig> }` — inline
    body node definitions replacing `body: string[]`. Each key is a body
    node ID, value is its full node config. `condition_node` must reference
    a key in `nodes`. Body node ordering derived from `inputs` declarations
    via topo-sort (>1 entry requires at least one `inputs` reference to
    prevent disconnected graph with arbitrary order).
  - NodeState: `{ ..., cost_usd?: number, result?: string }` — per-node cost
    from `CliRunOutput.total_cost_usd` and result excerpt (≤400 chars) from
    inline excerpt logic (filter empty → take 3 → join ` | ` → truncate 400),
    both set at completion via `markNodeCompleted()` optional params (FR-E17,
    FR-E22)
  - RunState: `{ ..., total_cost_usd?: number, claude_cli_version?: string }`
    — `total_cost_usd`: sum of all `nodes[*].cost_usd`, recomputed by
    `updateRunCost()` on each node completion (FR-E17).
    `claude_cli_version` (FR-E49): captured once at run start via
    `claude --version`; `undefined` when CLI unavailable (e.g. OpenCode
    runtime)
  - EngineOptions: `{ ..., budget_usd?: number, onNodeLifecycle?: (event) => void|Promise<void> }`
    — `budget_usd` is the workflow-wide USD cap from `--budget` (FR-E47).
    `onNodeLifecycle` is an embedding-only host callback (FR-E68); no YAML or
    CLI surface.
  - NodeLifecycleEvent: `{ run_id, node_id, status, timestamp, node, metadata,
    ...metadata }` — emitted after node state mutations for `running`,
    `completed`, `failed`, `waiting`, and `skipped` transitions (FR-E68).
    `metadata` copies optional `NodeState` fields: `error`,
    `error_category`, `duration_ms`, `cost_usd`, `result`, `session_id`,
    `question_json`, `iteration`.
  - RunJournalEvent: `{ schema_version, run_id, seq, event_id, kind, ts,
    ...payload }` — bootstrap, node lifecycle, attempt, loop, and terminal
    run facts, one JSONL record per fact (FR-E69).
  - WorkflowDefaults: `{ ..., budget?: { max_usd?: number; max_turns?: number } }`
    — default budget applied to all nodes via cascade merge (FR-E47)
  - NodeConfig: `{ ..., run_on?: "always"|"success"|"failure", phase?: string,
    env?: Record<string, string>, model?: string,
    allowed_paths?: string[] }` — `run_on` for conditional post-workflow
    execution; `phase` for artifact directory grouping; `env` for node-level
    env vars; `model` for per-node Claude model override (FR-E12);
    `allowed_paths` for scope-based file modification detection (FR-E37) —
    glob patterns defining permitted file modifications during agent invocation;
    `budget?: { max_usd?: number; max_turns?: number }` (FR-E47) — per-node
    budget limits. `max_usd` caps node cost; `max_turns` emitted as
    `--max-turns <N>` for Claude CLI
- **ERD:** N/A (file-based, no database).
- **Migration:** N/A.

### 4.1 Inter-Node Data Flow

- **Mechanism:** Filesystem-based. Each node reads input via `{{input.<node-id>}}`
  template variable pointing to predecessor's output directory. No manifest.
- **Directory structure:** `.flowai-workflow/runs/<run-id>/[<phase>/]<node-id>/` per node
  output. Phase subdir present when node's `phase` field is set in config.
- **Validation:** Engine validates output via configurable rules (file_exists,
  file_not_empty, contains_section, custom_script, frontmatter_field) after
  each node. Validation failures trigger continuation (resume with error
  context) rather than immediate node failure.
  - `artifact` (FR-E33, FR-E38): Composite rule — file existence +
    multi-section presence + frontmatter field presence in single rule. Config:
    `{ type: "artifact", path, sections?, fields? }` (at least one of
    `sections`/`fields` required). Fail-fast: file absent/empty → single error,
    no further checks. File present → check sections via heading regex →
    check fields via frontmatter parse. Missing sections and missing/empty
    fields each produce one aggregate error.
  - `frontmatter_field`: Reads artifact file, extracts YAML frontmatter via
    `^---\n([\s\S]*?)\n---` regex, parses target field, checks value against
    allowed set. Config: `{ type: "frontmatter_field", path, field, allowed }`.
  - `contains_section`: Checks artifact file for presence of a markdown section.
    Supports `on_error: continue` (non-fatal).
  - `custom_script`: Validation via external script execution, enabling
    continuation-on-failure for check errors.
  - Git repository-state rules (FR-E67): Parameterless validation rules run
    Git queries in the validation working directory. `git_worktree_clean`
    runs `git diff --name-only HEAD` for tracked changes and
    `git ls-files --others --exclude-standard` for untracked non-ignored
    files; any output fails the rule. `git_default_branch_checked_out` reads
    current branch via `git symbolic-ref --short HEAD` and default branch via
    `git symbolic-ref --short refs/remotes/origin/HEAD`, then compares the
    local branch name to the remote default branch name. `git_no_unpushed_commits`
    resolves `@{u}` and runs `git rev-list --count @{u}..HEAD`; any positive
    count fails the rule. These checks do not fetch; they validate against
    locally known Git refs.
- **Context management:** Claude CLI auto-compression handles large input sets.
- **Template variables:** `{{node_dir}}`, `{{input.*}}`, `{{run_dir}}`,
  `{{run_id}}`, `{{args.*}}`, `{{env.*}}`, `{{loop.iteration}}`,
  `{{file("path")}}` (FR-E32: inline file inclusion, path relative to CWD,
  single-pass — no re-interpolation of file contents),
  `{{flow_file("path")}}` (FR-E55: same as `file()` but path resolves against
  the current workflow directory `workDir/dirname(config_path)`),
  `{{bash("cmd")}}` (FR-E66: synchronous `bash -c <cmd>` with `cwd=workDir`,
  stdout substituted with trailing `\n` trimmed; non-zero exit throws with
  stderr; outer regex forbids `}` and newlines, inner forbids embedded `"`).
- **After-hook conventions:** Commands run from repo root (no `cd {{run_dir}}`
  prefix needed). Use `|| true` suffix to prevent hook failure from killing
  the node.

## 5. Logic

- **Algos:**
  - **Continuation Loop**: invoke agent -> validate -> if fail: resume with
    error context -> repeat (max N). If limit reached: fail node.
  - **Verbose Output Flow** (`-v` mode, agent nodes only): In
    `executeAgentNode()`: (1) resolve input artifact file paths+sizes from
    `ctx.input` dirs via `Deno.stat()` → `verboseInputs()`, (2) `runAgent()`
    (with `output` + `nodeId`) emits `verbosePrompt()` → Claude CLI executes →
    `verboseValidation()` → on failure: `verboseContinuation()` → retry.
    All verbose methods guarded by `verbosity !== "verbose"` — no-op in
    default/quiet. Output: human-readable stderr lines with section headers.
  - **Loop Node Log Saving** (callback-based, no I/O in `loop.ts`):
    `runLoop()` accumulates `AgentResult` per body-node iteration into
    `LoopResult.bodyResults[]` (pure data, no filesystem ops). In
    `executeLoopNode()` (`engine.ts`), the `onNodeComplete` callback iterates
    `bodyResults`, calling `saveAgentLog()` with iteration-qualified nodeId
    (`${id}-iter-${i}`). Guard: only on `result.success && result.output`.
    `saveAgentLog()` errors caught and warned (non-fatal) — audit I/O must not
    break loop execution. `runDir` resolved via `getRunDir(this.state.run_id)`
    (already in engine scope).
  - **Node Result Summary** (FR-E15, FR-E22): After agent node completion,
    `OutputManager.nodeResult()` prints a RESULT header, non-empty result lines
    indented by two spaces, and a cost/duration/turn footer. Compact excerpts
    (first 3 non-empty lines joined with ` | `, capped at 400 chars) are
    stored on `NodeState.result` for final summary rendering. Suppressed in
    quiet mode; shown in default and verbose modes.
  - **Verbose Edge Cases** (behavioral contracts verified by tests):
    - **Default mode (no `-v`):** All 4 verbose methods produce zero stderr
      output. `OutputManager` constructed with `verbose=false` suppresses all
      verbose calls unconditionally.
    - **Empty input dir:** `resolveInputArtifacts()` returns empty list →
      `verboseInputs()` reports `0 files` without error. No `Deno.stat()` calls.
    - **Missing file stat:** `Deno.stat()` failure on input artifact →
      graceful skip, verbose output includes error detail for affected path.
  - **File Inclusion Resolution (FR-E32, FR-E55):** In `resolve()`, when key
    matches `/^file\("(.+)"\)$/`: extract path → resolve relative to
    `workDir` (or `Deno.cwd()` when `workDir` undefined) →
    `Deno.readTextFileSync(resolved)`. When key matches
    `/^flow_file\("(.+)"\)$/`: same flow but the base is
    `workDir/ctx.workflow_dir` (the workflow folder containing
    `workflow.yaml`). Both share `readIncludedFile(fnName, path, resolved)`
    which throws `Error('{{${fnName}("${path}")}} — file not found:
    ${resolved}')` on miss and emits `console.warn()` when content size >
    `FILE_INCLUSION_SIZE_WARN_BYTES`. Content returned as-is — no
    re-interpolation. Nested template variables inside `file(...)` /
    `flow_file(...)` paths not supported (regex limitation). `workflow_dir`
    is populated by `Engine.buildContext` via `dirname(options.config_path)`;
    fixtures and external callers may omit it (defaults to "" → resolves
    against `workDir`).
    **Bash Substitution Resolution (FR-E66):** When key matches
    `/^bash\("(.+)"\)$/`: extract `cmd` → spawn
    `new Deno.Command("bash", {args: ["-c", cmd], cwd: workDir, stdout:
    "piped", stderr: "piped"}).outputSync()` → on `success: false` throw
    `{{bash("${cmd}")}} — exit ${code}: ${stderr}`; on success decode
    stdout, warn when length > `FILE_INCLUSION_SIZE_WARN_BYTES`, return
    with single trailing `\n` stripped. No re-interpolation. Spawn
    failure (e.g., bash missing) caught and rethrown with descriptive
    prefix. Validation accepts any `bash("...")` payload at load time;
    command syntax is not validated until interpolation.
    Load-time validation: `validateFileReferences(config, workDir,
    workflowDir)` in `config.ts` scans `task_template`/`prompt` /
    `system_prompt` fields for `{{(file|flow_file)("...")}}` regex, checks
    existence using the same base-resolution rules. Skips paths with `{{`
    (template vars unresolvable at load time).
  - **Hook Template Variable Validation (FR-E7):** In `validateNode()`,
    for each hook command (`before`/`after`): call
    `validateTemplateVars(hookCmd, knownInputs)` from `template.ts`.
    `knownInputs` = `allNodeIds` for top-level nodes;
    `[...allNodeIds, ...bodyNodeIds]` for loop body nodes. Algorithm:
    1. Extract all `{{...}}` patterns via regex (same pattern as `resolve()`).
    2. For each match: parse prefix. Validate against allowed set:
       `input.<id>` (id ∈ knownInputs), `env.<KEY>`, `args.<name>`,
       `loop.iteration`, `run_dir`, `run_id`, `node_dir`, `file("...")`,
       `flow_file("...")`, `bash("...")`.
    3. Unknown prefix or invalid `input.*` suffix → collect error string.
    4. Return all errors (batch, not fail-on-first).
    In `config.ts`: format each error with hook type + node ID, throw single
    config error. Runs at parse time via `loadConfig()` → `validateNode()`.
    Ensures `deno task check` catches misconfigured hooks before execution.
  - **Loop Input Forwarding Validation (FR-E35):** In `validateNode()` loop
    branch, after existing body node validation loop: for each body node,
    classify its `inputs` as internal (present in `bodyNodeIds`) or external.
    External inputs must appear in the enclosing loop node's `inputs` array
    (`node.inputs ?? []`). Algorithm:
    1. Collect `bodyNodeIds = new Set(Object.keys(node.nodes))`.
    2. Collect `loopInputs = new Set(node.inputs ?? [])`.
    3. For each body node: filter its `inputs` to those NOT in `bodyNodeIds`.
    4. For each such external input: if NOT in `loopInputs`, collect as missing.
    5. If any missing: throw config error naming body node, loop node, and
       missing input IDs. Single error per body node (all missing IDs listed).
    Parse-time check — runs during `loadConfig()` → `validateNode()`. No
    runtime overhead. Sibling body node references excluded from check.
  - **Loop Condition Field Validation (FR-E36):** Two-layer check:
    1. **Parse-time** (in `validateNode()` loop branch, after FR-E35 check):
       Look up condition node's `validate` array. Filter for rules with
       `type === "frontmatter_field"`. If `validate` block exists but no rule
       has `field === condition_field` → throw config error. If no `validate`
       block → skip (no contract). Inline — no new function.
    2. **Runtime** (in `extractConditionValue()`): After search loop, if
       result is `undefined` → throw with loop ID, field name, condition node
       ID, and output path. Requires `loopId` threaded to function (closure
       capture or param). Catches misconfigs that slip past parse-time (e.g.,
       condition node with no validate block but agent omits field).
  - **Scope-Based File Modification Detection (FR-E37):** In `runAgent()`,
    when `node.allowed_paths` is defined:
    1. Before first `invokeClaudeCli()`: `beforeSnapshot = await snapshotModifiedFiles()`.
    2. After each invocation: `afterSnapshot = await snapshotModifiedFiles()`.
    3. `violations = findViolations(beforeSnapshot, afterSnapshot, node.allowed_paths)`.
    4. If violations non-empty: inject synthetic `ValidationResult`
       `{ type: "scope_check", passed: false, message: "Out-of-scope modifications: <paths>" }`
       into validation results array.
    5. Continuation resume prompt includes both artifact and scope violations.
    6. `beforeSnapshot` updated to `afterSnapshot` for next iteration
       (incremental — only new changes detected per invocation).
    7. Shares `max_continuations` budget (AC #7).
    When `allowed_paths` undefined: skip snapshot entirely (zero overhead).
    `findViolations()` algorithm: `newMods = after − before` (set difference),
    for each path in `newMods`: match against `allowedPaths` globs; if no
    match → violation. Pure function — unit-testable without I/O.
  - **Post-Workflow Node Collection & Ordering**: `collectPostWorkflowNodes()`
    collects nodes where `run_on !== undefined` (replaces `run_always`-based
    collection). `sortPostWorkflowNodes()` sorts them topologically using
    `inputs` field (reuses `toposort()` from `dag.ts`).
  - **Post-Workflow Node Filtering**: Before executing each post-workflow node,
    engine applies per-node filter based on `run_on` value and
    `workflowSuccess`:
    - `run_on: "always"` → execute unconditionally.
    - `run_on: "success"` → skip if `!workflowSuccess`, call
      `markNodeSkipped()`.
    - `run_on: "failure"` → skip if `workflowSuccess`, call
      `markNodeSkipped()`.
  - **HITL via Engine-Owned MCP Server** (FR-E8, FR-E64; hitl-via-engine-mcp):
    Engine ships a single stdio MCP server (`flowai-workflow-hitl`)
    exposing one tool `request_human_input`. Detection uses the
    library's runtime-neutral `onToolUseObserved` hook (FR-L35);
    library v0.8.0 dropped the in-library HITL layer entirely and
    v0.8.1 added the generic `mcpServers` invoke field that the
    engine renders into each runtime's native MCP plumbing. Flow:
    1. When `defaults.hitl` is configured AND
       `adapter.capabilities.mcpInjection === true`, `runAgent()`
       passes `mcpServers` (one entry under `flowai-workflow-hitl`)
       and an `onToolUseObserved` observer to every `adapter.invoke()`
       (initial + continuation).
    2. Library renders the entry to the runtime-native plumbing
       (Claude `--mcp-config <tmp>`, OpenCode
       `OPENCODE_CONFIG_CONTENT`, Codex `--config mcp_servers.*`).
       Cursor adapter warns and drops it (no per-invocation MCP).
    3. Agent calls the MCP tool; runtime emits a `tool_use` event;
       observer matches the runtime-prefixed name
       (`mcp__flowai-workflow-hitl__request_human_input` /
       `flowai-workflow-hitl_request_human_input` /
       `flowai-workflow-hitl.request_human_input`), normalises the
       input into `HumanInputRequest`, returns `"abort"`.
    4. Engine reads `result.hitl_question` and dispatches to
       `handleAgentHitl({mode: "detect"})` in `node-dispatch.ts`.
    5. Engine calls `defaults.hitl.ask_script` (external workflow
       script) with question JSON + context args.
    6. Engine enters poll loop: `sleep(poll_interval)` → call
       `defaults.hitl.check_script` → if exit 0, read reply from
       stdout.
    7. Engine appends one `{ts, round, question, reply}` record to
       `<nodeDirAbs>/hitl.jsonl` (FR-E64; round counter from existing
       line count for crash-resume) BEFORE the resume call.
    8. Engine resumes the session through the same adapter
       (`resumeSessionId` + same `mcpServers` so nested HITL works).
    9. On `timeout` exceeded: node marked `failed`.
  - **Runtime-Normalized Logging**:
    Agent outputs are persisted as runtime-agnostic JSON logs using the
    normalized `CliRunOutput` shape. Transcript copying is capability-based:
    Claude copies external JSONL transcripts from `~/.claude/projects/...`;
    OpenCode writes only the engine-managed JSON log because the current
    integration does not expose a copyable external transcript file.
    Workflow config example:
    ```yaml
    defaults:
      on_failure_script: .flowai-workflow/scripts/rollback-uncommitted.sh
      hitl:
        ask_script: .flowai-workflow/scripts/hitl-ask.sh
        check_script: .flowai-workflow/scripts/hitl-check.sh
        artifact_source: plan/pm/01-spec.md
        poll_interval: 60
        timeout: 7200
    ```
  - **Pipeline Prepare Command (FR-E30):** In `runWithLock()`, after
    `ensureRunDirs()` + journal bootstrap, before level loop: if
    `!options.resume && defaults.prepare_command` is non-empty, calls
    `runPrepareCommand()`. Flow: build workflow-level `TemplateContext`
    (`node_dir: ""`, `input: {}`, real `run_dir`/`run_id`/`env`/`args`) →
    `interpolate(cmd, ctx)` → `Deno.Command("sh", ["-c", result])` →
    on non-zero exit: throw `Error("prepare_command failed (exit N): cmd")`.
    Caught by `run()` error handler → state saved → workflow aborts.
    Resume runs skip entirely (environment already prepared).
  - **Phase Registry Init**: `setPhaseRegistry(config)` called at engine
    startup before `ensureRunDirs()` in `engine.ts` `run()`. Uses exclusive
    if/else (FR-E33): populates from `phases:` block OR per-node `phase:`
    fields — never both (config validation rejects mixed configs at parse time).
    `getNodeDir()` resolves phase-aware paths: `${runDir}/${phase}/${nodeId}`
    when phase registered, `${runDir}/${nodeId}` otherwise. Evidence:
    `state.ts:20-36`, `engine.ts:135`.
  - **Error Handling Precedence (FR-E34)**: Two mechanisms interact:
    - `on_error: continue` (per-node): marks node `failed`, logs info message,
      continues workflow. Does NOT trigger `on_failure_script` at node level.
    - `on_failure_script` (workflow-end): evaluated once after all DAG levels
      complete, only when `workflowSuccess === false`.
    - **Log message (AC #1):** At the `on_error: continue` branch in
      `executeNode()` (~engine.ts:384), before `return true`:
      `this.output.status()` emits
      `[INFO] node <id>: failure suppressed by on_error: continue`.
      Deterministic — identifies which mechanism took effect.
    - **Interaction rules:**
      1. `on_error: continue` → log suppression, continue. Hook not triggered.
      2. All failures suppressed → `workflowSuccess === true` → hook NOT run.
      3. Any unsuppressed (fatal) failure → `workflowSuccess === false` → hook
         runs exactly once via `runFailureHook()`.
      4. Hook failure does not affect `on_error: continue` semantics (FR-E19).
    - **`runFailureHook()`:** private method in engine.ts. Executes
      `config.defaults.on_failure_script` via `Deno.Command()`. Swallows errors
      (hook must not crash engine). Called before post-workflow nodes when
      `workflowSuccess === false`. Script is workflow-specific — engine treats
      as opaque invocation (domain-agnostic). Failed node IDs available via
         replayed run state (`nodes[*].status === "failed"`).
  - **Semi-verbose filtering (FR-E21):** `formatEventForOutput(event,
    verbosity?)` accepts optional `Verbosity` param. When
    `verbosity === "semi-verbose"`, skips `tool_use` content blocks in
    `assistant` events — emits only `text` blocks. Default `undefined` =
    all blocks (backward-compatible). Log file writes call without verbosity
    (full output preserved). `onOutput` callback path passes verbosity from
    `AgentRunOptions` so terminal output is filtered at source.
  - **Run Budget Enforcement (FR-E47):** Inline checks at 4 sites, all using
    strict `>` (exact-equal to cap does NOT trigger):
    1. **Workflow-wide (engine.ts):** In `executeLevel()` (after each level
       and after each chunk when `max_parallel > 0`) via
       `checkWorkflowBudget("runtime")`: `if (options.budget_usd &&
       state.total_cost_usd > options.budget_usd)` → throws
       `Error("Budget exceeded: $X.XX > $Y.YY")`. Throw propagates to the
       outer try/catch in `runWithLock`, flipping `workflowSuccess=false`.
       The same helper runs once pre-level as `checkWorkflowBudget("resume")`
       using the resume-specific error prefix.
    2. **Per-node (engine.ts):** Inside `executeNode()`, after
       `markNodeCompleted()`: `if (resolvedBudget.max_usd &&
       state.nodes[id].cost_usd > resolvedBudget.max_usd)` → calls
       `markNodeFailed(..., "aborted")`, emits `nodeFailed`, then returns
       `onError === "continue"` so `on_error` still applies. For loop body
       nodes, `cost_usd` is the single iteration's cost — per-iteration
       semantics.
    3. **Loop workflow check (loop.ts):** After each body node
       `markNodeCompleted()`: workflow-wide throw identical to #1; the throw
       propagates from `runLoop` → `executeLoopNode` → `executeNode`'s catch,
       which marks the loop node failed before workflow abort.
    4. **Loop pre-check (loop.ts):** Before iteration spawn (iteration > 1)
       via exported `shouldPreemptLoop(budgetUsd, totalRunCost, totalLoopCost,
       completedIter)`: `avgIterCost = totalLoopCost / completedIter`; if
       `avgIterCost > (budgetUsd - totalRunCost)` → loop exits cleanly
       (`success=true`, `exit_reason: "budget_preempt"`). First iteration
       skips (no cost data). Heuristic is advisory — may preempt loops whose
       variance would have fit remaining budget.
    Cascade resolution: `resolveBudget(node, defaults, loopParent?)` exported
    from `config.ts`. Shallow first-defined-wins (same spirit as `model`
    resolution): `node.budget ?? loopParent.budget ?? defaults.budget`.
    Called from `engine.ts:executeNode`, `loop.ts:runLoop`, and
    `node-dispatch.ts` (to compute `maxTurns` for `runAgent`). `--max-turns`
    emission lives in exported `agent.ts:applyBudgetFlags(base, runtime,
    maxTurns)` — appends `--max-turns <N>` when `runtime === "claude"`,
    otherwise returns `base` unchanged. Used at initial invoke in
    `runAgent` (both fresh and continuation paths) and at HITL resume in
    `hitl.ts`. Pre-run warnings emitted by `engine.ts:warnBudgetCaveats`:
    (1) per non-Claude node with `budget.max_turns`; (2) when `--budget` is
    set while the default runtime is non-Claude (possible silent no-op).
    **Resume (`--resume`):** `state.total_cost_usd` loaded by journal replay;
    budget applies to the cumulative total. Engine aborts via
    `checkWorkflowBudget("resume")` before executing any node if the loaded
    state already exceeds the cap.
  - **Node Lifecycle Callback (FR-E68):** `node-lifecycle.ts` wraps
    `state.ts` mutators with awaited transitions (`nodeStarted`,
    `nodeCompleted`, `nodeFailed`, `nodeWaiting`, `nodeSkipped`). Each helper
    mutates `RunState`, snapshots `NodeLifecycleEvent`, appends the journal
    node fact, then awaits `EngineOptions.onNodeLifecycle`; append failure
    prevents publishing an unpersisted live fact. Timestamps reuse node
    timestamps where available. `EngineContext` threads helpers through all
    node paths; callback rejection becomes `NodeLifecycleCallbackError`
    without recursive failed-event emission.
  - **Durable Lifecycle Replay (FR-E69):** `run-journal.ts` owns the
    recovery surface. Writer appends enveloped JSON lines with monotonic `seq`
    and deterministic `event_id`, continuing after existing valid records on
    resume. Fresh runs write ordinary bootstrap facts, not a snapshot blob.
    Replay reads only the run directory, ignores duplicate `event_id`s and a
    malformed partial tail, fails on malformed non-tail lines, and derives
    `RunState`. Terminal records beat stale non-terminal run facts; later
    terminal facts can supersede earlier ones. Dashboard and resume replay the
    journal rather than `state.json`.
  - **CLI Auto-Update Prevention (FR-E49):** In `run()`, before node
    execution loop:
    1. Save original `Deno.env.get("DISABLE_AUTOUPDATER")`.
    2. `Deno.env.set("DISABLE_AUTOUPDATER", "1")`.
    3. Capture `claude --version` via `new Deno.Command("claude",
       ["--version"]).output()`. On success: store trimmed stdout in
       `state.claude_cli_version`, save state. On failure: log warning,
       leave field `undefined`.
    4. In `finally` block: restore original env value (or
       `Deno.env.delete()` if previously unset).
    `buildSpawnEnv()`: private helper returning
    `{ ...Deno.env.toObject(), DISABLE_AUTOUPDATER: "1" }`. User-provided
    env values for `DISABLE_AUTOUPDATER` always overridden. Available for
    future per-subprocess env needs; currently unused (child processes
    inherit parent env via `Deno.Command` default). Sequential-only
    `Engine.run()` contract (FR-E60) makes `Deno.env` mutation race-free.
  - **Embedded MCP Server (FR-E70):** `mcp-server.ts` implements a
    `@modelcontextprotocol/sdk`-based server with 7 tool registrations.
    `runMcpServer(workflowDir)` flow:
    1. Create `McpServer` instance with server name + version.
    2. Register 7 tools via `server.tool(name, schema, handler)`:
       - `get_workflow`: `loadConfig(join(workflowDir, "workflow.yaml"))` →
         return stringified `WorkflowConfig`.
       - `get_state({run_id})`: derive `runDir` from `workflowDir + /runs/ +
         run_id` → `replayRunJournal(runDir)` → return `RunState` JSON.
       - `list_runs`: iterate `Deno.readDir(workflowDir + /runs/)`, filter
         directories (skip `.lock`, non-dir), replay each → return array of
         `{run_id, status, total_cost_usd, node_count}`.
       - `tail_artifacts({run_id, node_id, filename, lines?})`: resolve path
         via `getNodeDir()` → read file → split lines → return last N
         (default 50).
       - `resume_node({run_id})`: construct `Engine({resume: true,
         config_path, run_id})`, call `.run()`. Returns final state status.
       - `cancel_run({run_id})`: `readLockInfo(defaultLockPath(workflowDir))`
         → verify `lockInfo.run_id === run_id` → `Deno.kill(lockInfo.pid,
         "SIGTERM")`. Returns confirmation or "no matching lock" error.
       - `apply_workflow_patch({operations})`: read `workflow.yaml` → parse
         YAML → apply JSON Patch operations (RFC 6902) → serialize YAML →
         write back. Operations validated before apply.
    3. Create `StdioServerTransport`.
    4. `await server.connect(transport)`.
    No signal handlers installed (FR-E61). No `Engine` state mutation except
    through `resume_node` (which creates its own `Engine` instance). Read-only
    tools (`get_workflow`, `get_state`, `list_runs`, `tail_artifacts`) do not
    acquire run lock. `cancel_run` reads lock but does not acquire/release it.
  - **Binary Compile Flow (FR-E39):** `scripts/compile.ts` iterates
    `TARGETS` array. Per target: construct `deno compile --allow-all --target
    <denoTarget> --output dist/flowai-workflow-<os>-<arch> cli.ts`. If
    `--dry-run`: print command string, skip execution. Otherwise:
    `new Deno.Command("deno", { args })` → `output()` → check
    `success`; on failure: throw with target + stderr. `dist/` dir created
    via `Deno.mkdirSync("dist", { recursive: true })` before loop.
    Release workflow: `gh release create` uploads all `dist/*` files as
    release assets. Tag name extracted from `GITHUB_REF_NAME` env var.
- **Rules:**
  - Artifacts overwritten on re-run (git history preserves previous).
  - QA iteration numbering restarts on re-run.

## 6. Non-Functional

- **Scale:** Single workflow per run. Sequential stages (no parallel agents).
- **Fault:** Node failure stops workflow (unless `on_error: continue`). Failure
  reported via `journal.jsonl` replay. `on_error: continue` emits info log per
  suppressed node (FR-E34). Configurable `on_failure_script` hook runs before
  post-workflow nodes only when `workflowSuccess === false` (not when all
  failures suppressed).
- **Logs:** Full transcripts per node in `.flowai-workflow/runs/<run-id>/logs/`.

## 7. Constraints

- **Simplified:** Pipeline runs sequentially (no parallel stages in v1).
- **Deferred:** Multi-repo support. Parallel workflows for multiple issues.
  Issue size/complexity limits. Budget alerts/notifications (FR-E47 covers
  enforcement only). Binary smoke tests in CI matrix. Package manager
  distribution. Windows binaries. Auto-update. SHA256 release checksums.
  MCP server HTTP/SSE transport (FR-E70 ships stdio only). MCP server
  `createMcpServer()` library-first factory API. HITL MCP server migration
  to SDK.
- **Deferred CLI flags per node:** Candidate flags need separate FRs after
  validation (`--max-budget-usd`, `--json-schema`, `--fallback-model`,
  `--name`, `--no-session-persistence`, `--settings`, `--mcp-config`,
  `--worktree`). Shipped: `--effort` (FR-E42),
  `--allowedTools`/`--disallowedTools` (FR-E48), `--permission-mode` (FR-E29).
