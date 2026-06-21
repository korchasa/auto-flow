<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — CLI and Observability


### 3.6 FR-E6: Verbose Output (`-v`)

- **Description:** With `-v` flag, engine output must provide full transparency into what is happening at every step — not just node start/stop, but the reasoning context: what input is being passed, what prompt is constructed, what validation is run, what the result is.
- **Motivation:** Current verbose mode shows only lifecycle events (started/completed/failed). Debugging workflow issues or understanding agent behavior requires reading log files after the fact.
- **Acceptance criteria:**
  - [x] `-v` shows the full task prompt text sent to each agent (after template interpolation). Evidence: `output.ts:109-114` (`verbosePrompt()`), `agent.ts:67-69`
  - [x] `-v` shows the list of input artifacts resolved for each node (file paths + sizes). Evidence: `output.ts:117-123` (`verboseInputs()`), `engine.ts:280`
  - [x] `-v` shows validation rule execution: which rules ran, pass/fail per rule, failure details. Evidence: `output.ts:126-137` (`verboseValidation()`), `agent.ts:98-104`
  - [x] `-v` shows continuation context: why continuation was triggered, what error text is appended. Evidence: `output.ts:140-151` (`verboseContinuation()`), `agent.ts:126-135`
  - [x] `-v` streams agent stdout in real-time (not buffered until completion). Evidence: `output.ts` (`nodeOutput()` method — pre-existing)
  - ~~`-v` shows safety check results~~ — `verboseSafety()` removed (engine domain-agnostic refactor; safety output now via agent stdout).
  - ~~`-v` shows commit details~~ — `verboseCommit()` removed (engine no longer commits; git operations delegated to agent nodes).
  - [x] Default mode (no `-v`) remains concise: node start/complete/fail + summary. Evidence: `output_test.ts:175-197` (all 6 verbose methods produce zero output in default mode)



### 3.15 FR-E15: Node Result Summary

- **Description:** After each agent node completes, the engine displays a
  one-line result summary in the terminal. Summary includes a multi-line
  extract of the agent result (up to 3 non-empty lines, total ≤400 chars,
  collapsed to a single line via ` | ` separator), cost, duration, and turn
  count. Provides at-a-glance workflow progress without requiring verbose mode.
- **Motivation:** Prior single-line truncation (`split("\n")[0].slice(0, 120)`)
  captured only the first line of result text, which is typically a generic
  header ("Done. Here's what I did:"). Substantive details — artifact paths,
  decisions, actions — appear in lines 2–5 (avg result: 626 chars, 6–15 lines).
- **Acceptance criteria:**
  - [x] `OutputManager.nodeResult(nodeId, output)` displays one-line summary.
    Evidence: `output.ts` (`nodeResult()` method).
  - [ ] Result text extract: up to 3 non-empty lines from `output.result`, each
    truncated to 120 chars, joined with ` | ` separator, total excerpt ≤400
    chars. Empty lines skipped. Single-line results unchanged.
  - [ ] Format: `[HH:MM:SS] <nodeId>  RESULT: <excerpt> | cost=$X.XXXX | duration=Xs | turns=N`.
    (excerpt = collapsed multi-line extract; no literal newlines in output)
  - [x] Shown in default and verbose modes; suppressed in quiet mode.
    Evidence: `output.ts` (`verbosity !== "quiet"` guard).
  - [x] Called for top-level agent nodes in `executeNode()` and for loop body
    nodes in `executeLoopNode()` `onNodeComplete` callback.
    Evidence: `engine.ts` (two call sites).
  - [ ] `extractResultExcerpt(result: string): string` — pure function in
    `output.ts`: filters empty lines, takes first 3, truncates each to 120
    chars, joins with ` | `, trims total to 400 chars. Unit-testable without I/O.
  - [ ] `deno task check` passes.



### 3.17 FR-E17: Aggregate Cost Data in Run State

- **Description:** Workflow engine records per-node cost and workflow-level
  total cost in run state, persisted through `journal.jsonl` lifecycle facts.
  Per-node `cost_usd` is sourced from `CliRunOutput.total_cost_usd`;
  top-level `total_cost_usd` is the sum across all completed nodes.
- **Motivation:** Dashboards and external tooling should not open one log file
  per node to compute cost. A single journal replay is sufficient with this
  change.
- **Acceptance criteria:**
  - **Tests:** `state_test.ts`, `engine_test.ts`, `loop_test.ts`
    (FR-E17; regression-locked).



### 3.18 FR-E18: Stream Log Timestamps

- **Description:** Each non-empty line written to the per-node stream-log
  file (`${node_dir}/stream.log`) is prefixed with a wall-clock timestamp in
  `[HH:MM:SS]` format (24-hour, zero-padded). Empty lines pass through without
  prefix. Terminal output via `onOutput` callback is NOT prefixed — timestamps
  appear in persisted logs only.

  **Engine-owned write (FR-E77 ACP-only).** The external
  `@korchasa/ai-ide-cli` ACP path persists nothing — it only forwards raw
  `session/update` params via `onEvent`. The engine (`src/engine/stream-log.ts`,
  wired in `src/engine/agent.ts::runAgent`) is the SOLE writer: it subscribes
  via `onEvent`, parses content through the library's public
  `extractSessionContent`, and writes timestamped `[stream] text:/tool:/result:`
  lines to one append handle spanning the initial invoke and every
  continuation. `streamLogPath` is NOT forwarded to `adapter.invoke` (dropped
  under ACP; forwarding triggers a spurious FR-E79 WARN). An FS open/write
  failure fails the node fast with `error_category: "cli_crash"`. Turn markers
  are best-effort (no sound per-turn boundary on the ACP stream).
- **Tasks:** [stream-log-owned-by-engine](../tasks/2026/06/stream-log-owned-by-engine.md).
- **Motivation:** Stream-log files lack temporal context, making it hard to
  correlate log entries with real-world events during post-incident analysis.
- **Acceptance criteria:**
  - **Tests:** `src/engine/stream-log_test.ts`, `src/engine/agent_test.ts`
    (FR-E18; regression-locked).



### 3.20 FR-E20: Repeated File Read Warning

- **Description:** Stream log emits a `[WARN]` line when the same file path is read more than 2 times within one node run. Warning includes the file path and read count. Informational only — does not block execution. Enables meta-agent to detect and diagnose repeated-read anti-patterns from log analysis.

  **Implementation:** `FileReadTracker` class in `src/engine/stream-log.ts`. Instantiated once per `createStreamLogWriter` call, i.e. **per node run** — counters span the initial invoke and every continuation (a deliberate divergence from the original per-invocation CLI scope; repeated reads across `--resume` attempts are also worth surfacing). On each normalized ACP tool item with `name === "Read"` and a string `file_path`, calls `tracker.track(file_path)`; a non-null result is appended to the stream log via `stampLines()`. Terminal `onOutput` callback unchanged (log-file-only).

  **Warning format:** `[WARN] repeated file read: <path> (<N> times)`.
- **Tasks:** [stream-log-owned-by-engine](../tasks/2026/06/stream-log-owned-by-engine.md).
- **Motivation:** Agents were silently re-reading the same file 3-4 times per session (run `20260313T025203`: PM agent read `documents/requirements-sdlc.md` 4 times consecutively), wasting tokens. The pattern was invisible to logging and prompt optimization tooling.
- **Acceptance criteria:**
  - **Tests:** `src/engine/stream-log_test.ts` (FR-E20; regression-locked).



### 3.21 FR-E21: Semi-Verbose Output Mode (`-s`)

- **Description:** Workflow engine must support a `semi-verbose` verbosity level
  (`-s` CLI flag) that shows agent text output but suppresses tool-call lines
  (e.g., `Read`, `Write`, `Bash` invocations). Sits between `normal` (silent)
  and `verbose` (full tool output).
- **Motivation:** `verbose` mode is too noisy for monitoring (hundreds of tool
  lines per node). `normal` shows nothing. Operators need intermediate view:
  agent reasoning + results without tool-call noise.
- **Acceptance criteria:**
  - **Tests:** `cli_test.ts`, `agent_test.ts`, `output_test.ts`
    (regression-locked; semi-verbose flag parsing, `formatEventForOutput`
    tool_use suppression, and `nodeOutput` gate).



### 3.22 FR-E22: Workflow Final Summary with Node Results

- **Description:** The workflow final summary block (printed after all nodes
  complete) must include per-node result text alongside existing metadata
  (Workflow name, Run ID, Status, Duration, Nodes count). Eliminates the need
  to scroll back through interleaved logs to find what each agent produced after
  a 30+ minute run.
- **Motivation:** Current `summary()` output (`output.ts:98-111`) renders
  only aggregate metadata. Per-node result text is available in
  `.flowai-workflow/runs/<run-id>/logs/<node-id>.json` but not in run state, forcing
  operators to read N log files after the run. Issue #109: "After a 30+ minute
  run, the operator has to scroll back through interleaved logs to find what
  each agent produced."
- **Acceptance criteria:**
  - [ ] `NodeState` in `types.ts` gains `result?: string` field — first 400
    chars of agent `CliRunOutput.result` text, persisted through journal
    node completion facts.
  - [ ] `markNodeCompleted()` in `state.ts` accepts optional `result?: string`
    param; writes it to `NodeState.result` when provided.
  - [ ] Engine passes `result` text to `markNodeCompleted()` for all agent node
    completions (top-level nodes in `executeNode()` and loop body nodes in
    `executeLoopNode()` `onNodeComplete` callback).
  - [ ] `OutputManager.summary()` renders per-node result lines below the
    existing aggregate block. One line per completed agent node:
    `  <nodeId padded>  <excerpt>` where excerpt = `extractResultExcerpt()`
    output (FR-E15). Skips nodes with no result (merge, human, skipped nodes).
  - [ ] Node results section is shown in default and verbose modes; suppressed
    in quiet mode. Consistent with `nodeResult()` visibility guard.
  - [ ] `RunSummary` interface in `types.ts` gains
    `nodeResults?: Record<string, string>` — map from nodeId → result excerpt.
    Populated by engine before calling `printSummary()`.
  - [ ] Backward-compatible: missing `result` fields render as absent
    (not error).
  - [ ] Unit tests cover: result present, result absent, quiet suppression,
    mixed node types (agent + merge).
  - [ ] `deno task check` passes.



### 3.23 FR-E23: CLI Help for `deno task check`

- **Description:** `scripts/check.ts` (`deno task check`) must respond to `--help` / `-h` with a usage synopsis describing what checks are run and exit 0. Unknown flags must produce an error message referencing `--help` and exit non-zero. Output format follows the pattern established by `cli.ts`.
- **Motivation:** Users must read source code to discover what `deno task check` does and whether any options exist. No help text forces unnecessary source inspection.
- **Acceptance criteria:**
  - **Tests:** `scripts/check_test.ts` (regression-locked; `checkArgs`
    and `printUsage` cases cover --help/-h exit 0, unknown-flag exit 1,
    usage-text content).


### 3.45 FR-E45: Subcommand Routing

- **Description:** CLI dispatches to subcommands: `flowai-workflow run
  <workflow> [options]` → DAG engine; `flowai-workflow init [options]` →
  project scaffolder. `--version` and `--help` handled before subcommand
  dispatch. No args → print usage and exit non-zero. Backward-compat shim:
  bare `--` flags without `run` → treated as `run <args>` with deprecation
  warning.
- **Motivation:** Explicit subcommand surface; no implicit interactive mode.
- **Acceptance criteria:**
  - [x] `run` subcommand → engine with all current flags.
    Evidence: `cli.ts` (`subcommand === "run"`).
  - [x] `init` subcommand → project scaffolder.
    Evidence: `cli.ts` (`subcommand === "init"`).
  - [x] No args → usage printed, exit 1.
    Evidence: `cli.ts` (default branch in `import.meta.main`).
  - [x] Backward-compat shim for bare `--` flags.
    Evidence: `cli.ts` (`subcommand.startsWith("--")` branch).
  - [x] `deno task run` updated with `run` subcommand.
    Evidence: `deno.json:18`.
  - [x] Existing parseArgs tests pass unchanged.
    Evidence: `cli_test.ts`.


### 3.46 FR-E46: Interactive REPL — removed

- **Description:** The interactive REPL (formerly `repl/mod.ts`,
  bundled skills `flowai-workflow-init` /
  `flowai-workflow-adapt-agents`, runtime persistence at
  `~/.config/flowai-workflow/runtime.json`) is no longer part of the
  product. `flowai-workflow` with no args prints usage and exits.
  Project scaffolding remains available via the `init` subcommand
  (FR-E45).
- **Status:** Removed.



### 3.47 FR-E47: Run Budget Enforcement

- **Description:** Engine enforces cost caps at two levels: (1) workflow-wide
  `--budget <USD>` CLI argument aborts the run when `total_cost_usd` exceeds
  the cap after any node completes; (2) per-node `budget.max_usd` in YAML
  config fails the node when its individual cost exceeds the per-node cap;
  (3) per-node `budget.max_turns` passes `--max-turns <N>` to the CLI
  runtime. Resolution cascade: node → enclosing loop → workflow `defaults`.
  Loop nodes additionally perform a pre-check before each iteration: if the
  running-average iteration cost exceeds remaining budget, the loop exits
  cleanly with reason `budget_preempt`. Engine already tracks per-node
  `cost_usd` and `total_cost_usd` in replayed run state (FR-E17).
- **Motivation:** Cost is tracked (FR-E17) but never enforced — SRS §0
  previously stated "No budget constraints." Runaway workflows on
  misconfigured or unbounded loops can incur unbounded API cost. Users need a
  safety cap without modifying workflow logic.
- **Decision:** [documents/tasks/2026/05/budget-cli-runtime-coupling.md](../tasks/2026/05/budget-cli-runtime-coupling.md)
- **Acceptance criteria:**
  - **Tests:** `cli_test.ts`, `config_test.ts`, `loop_test.ts`,
    `agent_test.ts` (FR-E47; regression-locked). See budget-cli-runtime-coupling.
  - [x] Full engine-level integration (workflow-wide abort mid-run)
    deferred — runtime adapter mocking infrastructure not yet present;
    covered indirectly via `checkWorkflowBudget` unit semantics.
    Evidence: `engine.ts:checkWorkflowBudget`.




### 3.53 FR-E53: Mandatory Positional Workflow Argument

- **Description:** `run` subcommand requires the workflow folder as
  a positional argument: `flowai-workflow run <workflow> [options]`.
  The engine loads `<workflow>/workflow.yaml`. Legacy `--config <path>`
  and the transitional `--workflow <dir>` flag are both removed
  (BREAKING; FR-S47). No autodetection — caller must always pass
  the path explicitly.

  **Rules:**
  - First non-flag token after `run` is `<workflow>`. Position is
    flexible — flags may appear before or after the positional.
  - Trailing slash on `<workflow>` is normalized.
  - A second positional argument is rejected.
  - `--config <path>` and `--workflow <dir>` MUST be rejected with
    a help message pointing to the positional form (no deprecation
    period; immediate BREAKING).
  - `parseArgs` is FS-free: `config_path` stays empty when no
    positional was supplied so unit tests can call `parseArgs([])`.
    `runEngine` enforces presence and emits `Missing workflow
    argument. Usage: flowai-workflow run <workflow> [options]`.
  - Engine derives `workflowDir = path.dirname(config_path)` once
    at construction and threads it to every state-path call (FR-E9
    update / DoD-14).
- **Acceptance criteria:**
  - **Tests:** `cli_test.ts`, `engine_test.ts` (FR-E53; regression-locked).
  - [x] `runEngine` emits `Missing workflow argument` when
    `config_path` is empty. Evidence: `cli.ts::runEngine`.
  - [x] `deno.json#tasks.run` uses positional form
    `cli.ts run .flowai-workflow/github-inbox`. Evidence: `deno.json`.




### 3.65 FR-E65: Sequential Cycles (`--cycles N`)

- **Description:** `run` subcommand accepts an optional `--cycles <N>` flag
  that repeats the whole workflow `N` times sequentially. Each cycle is an
  independent `Engine.run()` invocation with its own auto-generated run-id;
  cycles do not share state, artifacts, or worktrees. The launcher prints
  `=== Cycle N/M ===` on stderr before each cycle (suppressed under
  `-q`/`--quiet`).

  **Rules:**
  - `N` MUST be a positive integer (`Number.isInteger(N) && N >= 1`).
    Non-integer (`1.5`, `abc`), zero, or negative values are rejected with
    `Invalid --cycles value: <raw>. Expected positive integer.`
  - Default is `1` when the flag is absent — behaviour identical to
    pre-FR-E65 single-run mode.
  - **Fail-fast:** the launcher exits with code `1` on the first cycle whose
    final `state.status !== "completed"`; remaining cycles are skipped.
    All `N` cycles must complete for exit code `0`.
  - `--cycles` is CLI-only — it lives on `CliFlags`, never on
    `EngineOptions`. The Engine itself remains single-run; cycle
    orchestration is an `cli.ts::runEngine` concern.
  - **Mutual exclusion with `--resume`:** `--cycles N` with `N > 1` and
    `--resume <run-id>` are rejected at parse time with
    `--cycles cannot be combined with --resume: resume targets a single
    run-id, while --cycles starts fresh runs.` `N == 1` + `--resume` is
    permitted (effectively a no-op cycle wrapper).
  - `.env` loading and `--skip-update-check` evaluation occur once before
    the cycle loop, not per-cycle.
- **Motivation:** Unattended autonomous workflows (e.g. `autonomous-sdlc`)
  need to run multiple end-to-end iterations without manual re-invocation
  or external supervisors. A CLI-level wrapper avoids leaking repetition
  semantics into the domain-agnostic engine.
- **Acceptance criteria:**
  - **Tests:** `cli_test.ts` (FR-E65; regression-locked).
  - [x] `--cycles >1` + `--resume` rejected with the exact error string
    above. Evidence: `cli.ts::runEngine` (mutual-exclusion guard).
  - [x] Cycle banner emitted on stderr; suppressed under `-q`. Evidence:
    `cli.ts::runEngine` (cycle loop with `verbosity !== "quiet"` guard).



### 3.68 FR-E68: Node Lifecycle Callback for Embedded Hosts

- **Description:** `EngineOptions.onNodeLifecycle?` lets embedded hosts observe
  node lifecycle transitions without polling `state.json` or parsing logs.
  The callback is optional and additive; omitting it preserves standalone CLI
  behavior.
- **Motivation:** Hosts such as `flowai-center` embed `Engine` in a long-lived
  Deno process and need live node state for dashboards, queues, and operator
  surfaces. Reading persisted state after every filesystem write is expensive
  and loses exact transition ordering.
- Contract:
  - Callback payload is engine-native:
    `{ run_id, node_id, status, timestamp, node, metadata }`.
  - `metadata` copies optional fields from `NodeState`: `error`,
    `error_category`, `duration_ms`, `cost_usd`, `result`, `session_id`,
    `question_json`, `iteration`. These fields are also flattened on the event
    for ergonomic host access.
  - Callback fires after the in-memory `RunState` mutation and after the
    matching durable journal append on engine-owned paths, so hosts do not
    observe lifecycle facts that were not persisted.
  - Covered statuses: `running`, `completed`, `failed`, `waiting`, `skipped`.
  - Covered paths: top-level nodes, loop body nodes, post-workflow filtered
    skips, failed nodes, and HITL waiting.
  - Callback rejection is fail-fast: engine wraps it as
    `Node lifecycle callback failed for node '<id>' status '<status>': <msg>`.
    Callback-originated failures do not recursively emit another lifecycle
    event for the wrapper failure.
  - No workflow YAML, CLI flag, or user-facing config surface is added.
- **Acceptance criteria:**
  - [x] `EngineOptions` exposes optional `onNodeLifecycle`.
    Evidence: `types.ts::EngineOptions`, `engine_test.ts::EngineOptions exposes node lifecycle callback`.
  - [x] Payload includes run ID, node ID, status, timestamp, state snapshot,
    metadata, and flattened optional metadata.
    Evidence: `types.ts::NodeLifecycleEvent`, `node-lifecycle.ts::buildNodeLifecycleEvent`,
    `engine_test.ts::node lifecycle callback payload mirrors node state`.
  - [x] Callback ordering follows state mutation order.
    Evidence: `engine_test.ts::node lifecycle callback order follows state updates`.
  - [x] Omitted callback preserves no-hook behavior.
    Evidence: `engine_test.ts::node lifecycle callback omitted preserves no-hook behavior`.
  - [x] Lifecycle coverage includes top-level/special states, loop iteration
    metadata, and HITL waiting.
    Evidence: `engine_test.ts::node lifecycle callback covers top-level and special states`,
    `loop_test.ts::loop body lifecycle callback covers iteration metadata`,
    `hitl_test.ts::HITL waiting emits node lifecycle callback`.
  - [x] Callback rejection fails clearly.
    Evidence: `engine_test.ts::node lifecycle callback rejection fails run clearly`,
    `node-lifecycle.ts::NodeLifecycleCallbackError`.
  - [x] Full project check passes.


### 3.69 FR-E69: Durable Run Journal Replay

- **Description:** Each run persists a single append-only
  `<workflow>/runs/<run-id>/journal.jsonl` lifecycle stream. Embedded hosts
  replay this journal after restart to reconstruct engine-owned run facts
  without polling `state.json`, scanning runtime-specific IDE directories, or
  mixing engine state with host-owned queue data.
- **Motivation:** `EngineOptions.onNodeLifecycle` gives live transition facts,
  but hosts need the same facts after process restart. A single durable stream
  avoids split-brain recovery between live callbacks, latest-state snapshots,
  runtime transcripts, and host logs.
- Contract:
  - One `journal.jsonl` per run. No `state.json`, `snapshot.json`, or embedded
    snapshot records are part of the recovery contract.
  - Journal replay starts from an empty in-memory model. Bootstrap records
    (`run_started`, `workflow_loaded`, `node_declared`,
    `node_directory_declared`) establish the model before node transitions.
  - Every record carries `schema_version`, `run_id`, monotonic `seq`,
    deduplicatable `event_id`, `kind`, and `ts`.
  - Durable node records mirror live `NodeLifecycleEvent` semantics for
    `running`, `completed`, `failed`, `waiting`, and `skipped`.
  - Replay reconstructs run status, node status, attempt metadata, loop
    iteration metadata, session IDs, cost, errors, result excerpts, and node
    artifact paths.
  - Duplicate `event_id`s are ignored. A malformed partial final line is
    ignored; a malformed non-tail record fails replay clearly.
  - Terminal run records (`run_completed`, `run_failed`, `run_aborted`) are
    authoritative over stale non-terminal observations.
  - The contract is runtime-neutral across Claude, OpenCode, Cursor, and
    Codex; replay reads only the run directory journal.
- **Acceptance criteria:**
  - [x] Engine writes ordered `journal.jsonl` records before the first
    executable node transition. Evidence:
    `lifecycle-replay_test.ts::persists ordered run and node lifecycle records`.
  - [x] Replay deduplicates records and ignores a malformed partial tail.
    Evidence:
    `lifecycle-replay_test.ts::replay deduplicates records and ignores partial tail`.
  - [x] Durable node records mirror live callback payload semantics. Evidence:
    `lifecycle-replay_test.ts::durable node records mirror live lifecycle semantics`.
  - [x] Replay reconstructs host recovery state from journal only. Evidence:
    `lifecycle-replay_test.ts::replay reconstructs host recovery snapshot`,
    `lifecycle-replay_test.ts::resume state is reconstructed from journal only`.
  - [x] Terminal workflow facts dominate stale non-terminal observations.
    Evidence:
    `lifecycle-replay_test.ts::terminal workflow record wins over stale running snapshot`.
  - [x] Dashboard reads replayed journal state. Evidence:
    `scripts/generate-dashboard_test.ts::readRunState — replays valid journal.jsonl`.



### 3.79 FR-E79: Runtime `onCallbackError` Surfaced as Engine WARN

- **Description:** Engine wires
  `RuntimeInvokeOptions.onCallbackError` (sibling-repo
  `@korchasa/ai-ide-cli`, FR-L32) on every `adapter.invoke()` it makes
  from `runAgent` (initial + resume). The supplied handler routes the
  callback through `OutputManager.warn` with a node-tagged prefix
  `<nodeId padded to 16> runtime <source>: <err.message or String(err)>`.
  Two diagnostic classes flow through this channel: (a) consumer-callback
  throws (`onEvent`, `onStderr`, `onToolUseObserved`, `onSendFailed`),
  (b) ACP transport degraded-option entries
  (`runtime/acp/adapter.ts::reportDegradedOptions`, FR-L39 — e.g.
  `systemPrompt` inlined, `streamLogPath` dropped, `resumeSessionId`
  ignored). When `output` or `nodeId` is omitted (headless embedders),
  the engine sends `onCallbackError: undefined` so the library falls
  back to its default `console.warn` — pre-existing behaviour
  preserved.
- **Tasks:** [engine-warn-on-runtime-degraded-options](../tasks/2026/06/engine-warn-on-runtime-degraded-options.md).
- **Motivation:** Per the LumaTale ACP incident report
  ([`documents/tasks/2026/06/acp-codex-transport-issues-report.md`](../tasks/2026/06/acp-codex-transport-issues-report.md))
  P3, the engine had no handler on this channel. The library's
  default `console.warn` carries no node context and bypasses the
  `OutputManager` verbosity gate, so a ~40 KB system_prompt silently
  inlined into `prompt[0].text` produced zero operator-visible
  diagnostic before the opaque `-32700` failure.
- **Acceptance criteria:**
  - **Tests:** `agent_test.ts` (FR-E79; regression-locked).
  - [x] Behaviour unchanged when `OutputManager` is omitted from
    `runAgent` options — the runtime sees `onCallbackError: undefined`
    and the library's default handler runs. Evidence:
    `agent.ts::runAgent` (callback constructed only when
    `output && nodeId`).



### 3.80 FR-E80: Cumulative Wall-Clock Retry Cap

- **Description:** Engine enforces an optional per-node cumulative
  wall-clock budget covering the SUM of (library-internal retries +
  engine-level validation continuations). Field
  `settings.max_retry_wall_clock_seconds?: number` (positive integer,
  seconds; undefined ≡ no cap) cascades through the standard 3-tier
  defaults pipeline (hardcoded → `defaults` → `node.settings`).
  When configured, `runAgent` creates ONE `AbortController` shared
  across every `adapter.invoke()` it makes — initial invoke plus all
  continuations — forwarded as
  `RuntimeInvokeOptions.signal` (sibling-repo `@korchasa/ai-ide-cli`).
  A single `setTimeout(cap * 1000)` aborts the controller on expiry;
  the library cooperatively kills its own subprocess and returns. The
  engine then short-circuits to a structured failure with
  `error_category: "retry_budget_exceeded"`, emits a node-tagged WARN
  (`<nodeId padded to 16>wall-clock budget Ns exceeded after K attempt(s)`),
  and skips the continuation loop. The budget timer is cleared on every
  exit path via a `try`/`finally` around the post-create body — success,
  fail-fast, HITL early-return, continuation exhaustion, hook failure.
- **Tasks:** [acp-codex-followups](../tasks/2026/06/acp-codex-followups.md).
- **Motivation:** Per the LumaTale ACP incident report
  ([`documents/tasks/2026/06/acp-codex-transport-issues-report.md`](../tasks/2026/06/acp-codex-transport-issues-report.md))
  P4, a deterministic-failure `tech-lead-review` node spent ~2 h
  retrying the same `JSON-RPC -32700` parser failure because the
  library's classifier treats it as retryable and the workflow set
  `max_retries: 10` × per-attempt timeout. Per-attempt `timeout_seconds`
  bounds ONE attempt; nothing bounded the cumulative cost. This FR adds
  a generic per-node ceiling that bounds operator pain regardless of
  how the library classifies the upstream error.
- **Dep:** FR-E77 (transport agnostic — same cap on `cli` and `acp`);
  FR-L33 (library `RuntimeInvokeOptions.signal` is the cooperative
  abort channel).
- **Acceptance criteria:**
  - **Tests:** `config_test.ts`, `agent_runtime_test.ts`, `state_test.ts`
    (FR-E80; regression-locked).
  - [x] Behaviour unchanged when the field is omitted — engine sends
    `signal: undefined` and creates no `AbortController` or timer.
    Evidence: `agent.ts::runAgent` (AbortController constructed only
    when `wallClockCapSec !== undefined`).
  - [x] Cap value validated at config load: positive integer at both
    `defaults` and per-node levels. Evidence:
    `config.ts::validateWallClockBudget`.
  - [x] Documentation map updated. Evidence:
    `documents/requirements-engine.md` FR-E80 row;
    `documents/index.md` FR-E80 row.
