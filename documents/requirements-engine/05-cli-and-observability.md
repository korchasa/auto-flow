<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — CLI and Observability


### 3.6 FR-E6: Verbose Output (`-v`)

- **Description:** With `-v` flag, engine output must provide full transparency into what is happening at every step — not just node start/stop, but the reasoning context: what input is being passed, what prompt is constructed, what validation is run, what the result is.
- **Motivation:** Current verbose mode shows only lifecycle events (started/completed/failed). Debugging workflow issues or understanding agent behavior requires reading log files after the fact.
- **Acceptance criteria:**
  - [x] `-v` shows the full task prompt text sent to each agent (after template interpolation). Evidence: `engine/output.ts:109-114` (`verbosePrompt()`), `engine/agent.ts:67-69`
  - [x] `-v` shows the list of input artifacts resolved for each node (file paths + sizes). Evidence: `engine/output.ts:117-123` (`verboseInputs()`), `engine/engine.ts:280`
  - [x] `-v` shows validation rule execution: which rules ran, pass/fail per rule, failure details. Evidence: `engine/output.ts:126-137` (`verboseValidation()`), `engine/agent.ts:98-104`
  - [x] `-v` shows continuation context: why continuation was triggered, what error text is appended. Evidence: `engine/output.ts:140-151` (`verboseContinuation()`), `engine/agent.ts:126-135`
  - [x] `-v` streams agent stdout in real-time (not buffered until completion). Evidence: `engine/output.ts` (`nodeOutput()` method — pre-existing)
  - ~~`-v` shows safety check results~~ — `verboseSafety()` removed (engine domain-agnostic refactor; safety output now via agent stdout).
  - ~~`-v` shows commit details~~ — `verboseCommit()` removed (engine no longer commits; git operations delegated to agent nodes).
  - [x] Default mode (no `-v`) remains concise: node start/complete/fail + summary. Evidence: `engine/output_test.ts:175-197` (all 6 verbose methods produce zero output in default mode)



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
    Evidence: `engine/output.ts` (`nodeResult()` method).
  - [ ] Result text extract: up to 3 non-empty lines from `output.result`, each
    truncated to 120 chars, joined with ` | ` separator, total excerpt ≤400
    chars. Empty lines skipped. Single-line results unchanged.
  - [ ] Format: `[HH:MM:SS] <nodeId>  RESULT: <excerpt> | cost=$X.XXXX | duration=Xs | turns=N`.
    (excerpt = collapsed multi-line extract; no literal newlines in output)
  - [x] Shown in default and verbose modes; suppressed in quiet mode.
    Evidence: `engine/output.ts` (`verbosity !== "quiet"` guard).
  - [x] Called for top-level agent nodes in `executeNode()` and for loop body
    nodes in `executeLoopNode()` `onNodeComplete` callback.
    Evidence: `engine/engine.ts` (two call sites).
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
  - [x] `NodeState.cost_usd?: number` field written at node completion time.
    Evidence: `engine/types.ts` (`NodeState.cost_usd`), `engine/state.ts`
    (`markNodeCompleted()` optional `costUsd` param).
  - [x] `RunState.total_cost_usd?: number` is the sum of all `nodes[*].cost_usd`.
    Evidence: `engine/state.ts` (`updateRunCost()` / `recomputeTotalCost()`).
  - [x] Fields written alongside existing fields at node completion.
    Evidence: `engine/engine.ts` and `engine/loop.ts` — both pass
    `result.output?.total_cost_usd` to `markNodeCompleted()`.
  - [x] Loop iteration nodes also report cost.
    Evidence: `engine/loop.ts` loop body call site.
  - [x] Backward-compatible: fields are optional; existing state files without
    cost fields remain valid.
  - [x] Unit tests cover: cost present, cost absent, mixed multi-node, all-undefined.
    Evidence: `engine/state_test.ts`.



### 3.18 FR-E18: Stream Log Timestamps

- **Description:** Each non-empty line written to the stream log file
  (`.flowai-workflow/runs/<run-id>/logs/<node-id>.jsonl`) is prefixed with a wall-clock
  timestamp in `[HH:MM:SS]` format (24-hour, zero-padded). Empty lines pass
  through without prefix. Terminal output via `onOutput` callback is NOT
  prefixed — timestamps appear in persisted logs only.
- **Motivation:** Raw JSONL log files lack temporal context, making it hard to
  correlate log entries with real-world events during post-incident analysis.
- **Acceptance criteria:**
  - [x] Each non-empty line in the stream log file is prefixed with `[HH:MM:SS]`.
    Evidence: `engine/agent.ts:606-611` (`stampLines()`),
    `engine/agent_test.ts:400-407` (single-line test),
    `engine/agent_test.ts:409-424` (multi-line test).
  - [x] Timestamp reflects wall-clock time when the event was received (not batch time).
    Evidence: `engine/agent.ts:594-600` (`tsPrefix()` calls `new Date()` at call time),
    `engine/agent.ts:384,402` (`stampLines` called inside stream processing loop).
  - [x] Terminal output via `onOutput` callback is NOT prefixed with timestamps.
    Evidence: `engine/agent.ts:386,404` (`onOutput` receives raw `summary` without `stampLines`).
  - [x] Timestamp format is `[HH:MM:SS] <content>` (24-hour, zero-padded, space before content).
    Evidence: `engine/agent.ts:594-600` (format construction),
    `engine/agent_test.ts:391-398` (format regex test).
  - [x] Empty lines pass through to stream log without timestamp prefix.
    Evidence: `engine/agent.ts:609` (identity branch in `stampLines` map),
    `engine/agent_test.ts:426-442` (empty-line test).
  - [x] `deno task check` passes.



### 3.20 FR-E20: Repeated File Read Warning

- **Description:** Stream log emits a `[WARN]` line when the same file path is read more than 2 times within one agent session (`executeClaudeProcess()` invocation). Warning includes the file path and read count. Informational only — does not block execution. Enables meta-agent to detect and diagnose repeated-read anti-patterns from log analysis.
- **Motivation:** Agents were silently re-reading the same file 3-4 times per session (run `20260313T025203`: PM agent read `documents/requirements-sdlc.md` 4 times consecutively), wasting tokens. The pattern was invisible to logging and prompt optimization tooling.
- **Implementation:** `FileReadTracker` class in `engine/agent.ts`. Instantiated per `executeClaudeProcess()` call (counters reset per invocation). In event loop: for `tool_use` blocks with `name === "Read"`, calls `tracker.track(block.input.file_path)`. Non-null result written to log via `stampLines()`. Terminal `onOutput` callback unchanged (log-file-only).
- **Warning format:** `[WARN] repeated file read: <path> (<N> times)`.
- **Acceptance criteria:**
  - [x] Stream log emits `[WARN] repeated file read: <path> (<N> times)` when same path is read >2 times in one session. Evidence: `engine/agent.ts:332` (`FileReadTracker` class), `engine/agent.ts:346` (`track()` method), commit `ebe7cb2`.
  - [x] Warning includes file path and read count. Evidence: `engine/agent.ts:346` (`FileReadTracker.track()` return value format).
  - [x] Warning is log-file-only — terminal `onOutput` callback unchanged. Evidence: `engine/agent.ts:410` (`tracker` used in `executeClaudeProcess()`, warning written via `stampLines()` to logFile only).
  - [x] Counter resets per `executeClaudeProcess()` invocation (not cross-continuation). Evidence: `engine/agent.ts:410` (`FileReadTracker` instantiated inside `executeClaudeProcess()`).
  - [x] Execution not blocked by warning. Evidence: `engine/agent.ts:346` (`track()` returns warning string; engine continues normally).
  - [x] `FileReadTracker` is a pure-logic class — unit-testable without I/O. Evidence: `engine/agent_test.ts:790-855` (FileReadTracker unit tests).
  - [x] `deno task check` passes. Evidence: QA PASS — all tests pass (run `20260314T060523`).



### 3.21 FR-E21: Semi-Verbose Output Mode (`-s`)

- **Description:** Workflow engine must support a `semi-verbose` verbosity level
  (`-s` CLI flag) that shows agent text output but suppresses tool-call lines
  (e.g., `Read`, `Write`, `Bash` invocations). Sits between `normal` (silent)
  and `verbose` (full tool output).
- **Motivation:** `verbose` mode is too noisy for monitoring (hundreds of tool
  lines per node). `normal` shows nothing. Operators need intermediate view:
  agent reasoning + results without tool-call noise.
- **Acceptance criteria:**
  - [x] `Verbosity` type includes `"semi-verbose"` value alongside `"quiet"`,
    `"normal"`, `"verbose"`. Evidence: `engine/types.ts` (`Verbosity` union).
  - [x] `-s` CLI flag maps to `semi-verbose` verbosity. Evidence: `engine/cli.ts`.
  - [x] In semi-verbose mode, `formatEventForOutput()` skips `tool_use` content
    blocks in `assistant` events — emits only `text` blocks. Evidence:
    `engine/agent.ts` (`formatEventForOutput()` with `verbosity` param).
  - [x] Log file writes are unaffected — full output preserved. Evidence:
    `engine/agent.ts` (log path calls `formatEventForOutput()` without verbosity).
  - [x] `nodeOutput()` gate shows in both `verbose` and `semi-verbose`. Evidence:
    `engine/output.ts` (`nodeOutput()` condition).
  - [x] `deno task check` passes. Evidence: design.md (FR-E21 referenced as implemented).



### 3.22 FR-E22: Workflow Final Summary with Node Results

- **Description:** The workflow final summary block (printed after all nodes
  complete) must include per-node result text alongside existing metadata
  (Workflow name, Run ID, Status, Duration, Nodes count). Eliminates the need
  to scroll back through interleaved logs to find what each agent produced after
  a 30+ minute run.
- **Motivation:** Current `summary()` output (`engine/output.ts:98-111`) renders
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

- **Description:** `scripts/check.ts` (`deno task check`) must respond to `--help` / `-h` with a usage synopsis describing what checks are run and exit 0. Unknown flags must produce an error message referencing `--help` and exit non-zero. Output format follows the pattern established by `engine/cli.ts`.
- **Motivation:** Users must read source code to discover what `deno task check` does and whether any options exist. No help text forces unnecessary source inspection.
- **Acceptance criteria:**
  - [x] `--help` / `-h` prints usage synopsis and exits 0.
  - [x] Usage text documents all checks performed (type-check, tests, lint,
    workflow integrity, secret detection) and any flags.
  - [x] Unknown flags print an error message referencing `--help` and exit
    non-zero.
  - [x] `deno task check` (no args) continues to run all checks unchanged
    (backward-compatible).
  - [x] `deno task check` passes (self-check).


