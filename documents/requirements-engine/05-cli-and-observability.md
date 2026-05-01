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



### 3.17 FR-E17: Aggregate Cost Data in state.json

- **Description:** Workflow engine persists per-node cost and workflow-level total
  cost in `state.json`, eliminating the need to read N+1 separate log files to
  build a cost summary. Per-node `cost_usd` is sourced from
  `CliRunOutput.total_cost_usd`; top-level `total_cost_usd` is the sum across
  all completed nodes.
- **Motivation:** Dashboards and external tooling currently must open one log file
  per node to compute cost. A single `state.json` read is sufficient with this
  change.
- **Acceptance criteria:**
  - **Tests:** `state_test.ts`, `engine_test.ts`, `loop_test.ts`
    (FR-E17; regression-locked).



### 3.18 FR-E18: Stream Log Timestamps

- **Description:** Each non-empty line written to the stream log file
  (`.flowai-workflow/runs/<run-id>/logs/<node-id>.jsonl`) is prefixed with a wall-clock
  timestamp in `[HH:MM:SS]` format (24-hour, zero-padded). Empty lines pass
  through without prefix. Terminal output via `onOutput` callback is NOT
  prefixed — timestamps appear in persisted logs only.
- **Motivation:** Raw JSONL log files lack temporal context, making it hard to
  correlate log entries with real-world events during post-incident analysis.
- **Acceptance criteria:**
  - **Tests:** `agent_test.ts` (regression-locked; `tsPrefix` and
    `stampLines` cases at lines 391-442 cover format, single-line,
    multi-line, and empty-line passthrough).



### 3.20 FR-E20: Repeated File Read Warning

- **Description:** Stream log emits a `[WARN]` line when the same file path is read more than 2 times within one agent session (`executeClaudeProcess()` invocation). Warning includes the file path and read count. Informational only — does not block execution. Enables meta-agent to detect and diagnose repeated-read anti-patterns from log analysis.
- **Motivation:** Agents were silently re-reading the same file 3-4 times per session (run `20260313T025203`: PM agent read `documents/requirements-sdlc.md` 4 times consecutively), wasting tokens. The pattern was invisible to logging and prompt optimization tooling.
- **Implementation:** `FileReadTracker` class in `agent.ts`. Instantiated per `executeClaudeProcess()` call (counters reset per invocation). In event loop: for `tool_use` blocks with `name === "Read"`, calls `tracker.track(block.input.file_path)`. Non-null result written to log via `stampLines()`. Terminal `onOutput` callback unchanged (log-file-only).
- **Warning format:** `[WARN] repeated file read: <path> (<N> times)`.
- **Acceptance criteria:**
  - **Tests:** `agent_test.ts` (regression-locked; `FileReadTracker`
    cases at lines 790-855 cover threshold, per-path independence,
    warning format, consecutive warnings, reset).



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
  `.flowai-workflow/runs/<run-id>/logs/<node-id>.json` but not in `state.json`, forcing
  operators to read N log files after the run. Issue #109: "After a 30+ minute
  run, the operator has to scroll back through interleaved logs to find what
  each agent produced."
- **Acceptance criteria:**
  - [ ] `NodeState` in `types.ts` gains `result?: string` field — first 400
    chars of agent `CliRunOutput.result` text, persisted to `state.json`
    at node completion.
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
  - [ ] Backward-compatible: existing `state.json` files without `result`
    fields remain valid; missing results render as absent (not error).
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
- **Acceptance:**
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

- **Status:** Removed. The interactive REPL (formerly `repl/mod.ts`,
  bundled skills `flowai-workflow-init` /
  `flowai-workflow-adapt-agents`, runtime persistence at
  `~/.config/flowai-workflow/runtime.json`) is no longer part of the
  product. `flowai-workflow` with no args prints usage and exits.
  Project scaffolding remains available via the `init` subcommand
  (FR-E45).



### 3.47 FR-E47: Run Budget Enforcement

- **ADR:** [documents/adrs/0009-budget-cli-runtime-coupling.md](../adrs/0009-budget-cli-runtime-coupling.md)
- **Description:** Engine enforces cost caps at two levels: (1) workflow-wide
  `--budget <USD>` CLI argument aborts the run when `total_cost_usd` exceeds
  the cap after any node completes; (2) per-node `budget.max_usd` in YAML
  config fails the node when its individual cost exceeds the per-node cap;
  (3) per-node `budget.max_turns` passes `--max-turns <N>` to the CLI
  runtime. Resolution cascade: node → enclosing loop → workflow `defaults`.
  Loop nodes additionally perform a pre-check before each iteration: if the
  running-average iteration cost exceeds remaining budget, the loop exits
  cleanly with reason `budget_preempt`. Engine already tracks per-node
  `cost_usd` and `total_cost_usd` in `state.json` (FR-E17).
- **Motivation:** Cost is tracked (FR-E17) but never enforced — SRS §0
  previously stated "No budget constraints." Runaway workflows on
  misconfigured or unbounded loops can incur unbounded API cost. Users need a
  safety cap without modifying workflow logic.
- **Acceptance criteria:**
  - **Tests:** `cli_test.ts`, `config_test.ts`, `loop_test.ts`,
    `agent_test.ts` (FR-E47; regression-locked). See ADR-0009.
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
- **Rules:**
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
- **Acceptance:**
  - **Tests:** `cli_test.ts`, `engine_test.ts` (FR-E53; regression-locked).
  - [x] `runEngine` emits `Missing workflow argument` when
    `config_path` is empty. Evidence: `cli.ts::runEngine`.
  - [x] `deno.json#tasks.run` uses positional form
    `cli.ts run .flowai-workflow/github-inbox`. Evidence: `deno.json`.
