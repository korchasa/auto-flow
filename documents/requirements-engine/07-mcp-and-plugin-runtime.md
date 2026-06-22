<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — MCP Server and Plugin Runtime

Embedded MCP server (FR-E73), the plugin's self-contained runtime that
auto-registers it (FR-E74, superseded by FR-E78), Codex subagent
delivery as skills (FR-E76), the engine binary precondition +
release distribution model (FR-E78), and the parent-death watchdog that
keeps stdio MCP servers from leaking as orphans (FR-E83). All depend on
FR-E70 (plugin payload shape) but are kept here to fit within the
per-file token budget.


### 3.73 FR-E73: Embedded MCP Server Over Engine

- **Description:** The engine exposes an embedded Model Context Protocol
  (MCP) server with nine engine-control tools (the eighth,
  `provide_human_input`, added by FR-E75; the ninth, `start_run`, added by
  FR-E84), accessible via the
  `flowai-workflow mcp <workflow>` subcommand. Default transport is stdio;
  the server core is transport-agnostic so future HTTP/SSE consumers swap
  transports without touching tool handlers. Built on
  `npm:@modelcontextprotocol/sdk`. The server is domain-agnostic — every
  tool operates on generic workflow primitives (config, run state,
  artifacts, lock) and contains no git, GitHub, or PR awareness.

  **Tool surface** (each tool returns JSON-serialised payloads inside an
  MCP `text` content block; errors are MCP tool-level errors with
  `isError: true`, never transport-level errors):

  - `get_workflow()` — return the parsed `workflow.yaml` as JSON.
  - `get_state({ run_id })` — replay the run journal and return `RunState`.
  - `list_runs()` — enumerate `<workflowDir>/runs/`, replay each, return
    `{ run_id, status, total_cost_usd, node_count }` per entry. Per-run
    replay failures degrade to `{ run_id, error }`; the call never aborts.
  - `tail_artifacts({ run_id, node_id, filename, lines? })` — read the
    artifact file under the node directory and return the last N lines
    (default 50).
  - `start_run({ prompt?, wait? })` — start a FRESH run (FR-E84).
    `wait:false` (default) launches the engine as an independent detached
    process and returns `{ run_id, pid }` immediately; `wait:true` runs
    in-process, blocks until completion, and returns `{ run_id, status,
    total_cost_usd }`. Rejects when a run already holds the workflow lock.
    Delegates to the shared `commands.startRun` (the single
    `Engine({resume:false})` construction site).
  - `resume_node({ run_id })` — resume a run and return the final
    `RunState` summary. Delegates to the shared `commands.resumeRun`
    (FR-E75: the single `Engine({resume:true})` construction site, also
    used by CLI `run --resume`). Blocks until the engine completes (may
    take minutes).
  - `cancel_run({ run_id })` — read the workflow lock, send SIGTERM to the
    holder. Rejects when `lockInfo.run_id !== run_id`. Treats
    `Deno.errors.NotFound` and `PermissionDenied` from `Deno.kill` as a
    benign no-op (process already gone between read and kill).
  - `apply_workflow_patch({ operations })` — apply add/replace/remove ops
    (JSON Pointer paths per RFC 6901) to `workflow.yaml`. Rejects ops
    targeting the root or the `version` key. Caveat: `@std/yaml` round-
    trip drops comments and may normalise quoting.
  - `provide_human_input({ run_id, node_id, text })` — deliver a human
    reply to a waiting HITL node via the run's local inbox file
    (transport-independent); returns `{ inboxPath, live }`. Write-only —
    the live engine poll loop consumes it; when `live` is false, resume
    the run separately. Delegates to `commands.deliverHumanAnswer`
    (FR-E75; see [04-runtime-and-hooks](04-runtime-and-hooks.md)).

  **Process model invariants** (carried from FR-E59/E60/E61):

  - `runMcpServer()` never installs OS signal handlers — the CLI installs
    them once at top-of-`if (import.meta.main)` for all subcommands.
  - Per-run `PhaseRegistry`: each `resume_node` call builds its own
    `Engine` instance.
  - Sequential `Engine.run()`: concurrent `resume_node` calls for the same
    workflow folder are serialised by the existing per-workflow run lock;
    the tool never adds a second lock layer.
  - Read-only tools (`get_workflow`, `get_state`, `list_runs`,
    `tail_artifacts`) do not acquire the run lock.

- **Tasks:** [embedded-mcp-server](../tasks/2026/05/embedded-mcp-server.md)
- **Motivation:** Unlocks agent-driven engine control without spawning a
  CLI subprocess (idea #3 in `documents/ideas.md`, top-priority
  shortlist). Aligns with FR-E59/E60/E61 host-embedding direction.
- **Acceptance criteria:**
  - **Tests:** `mcp-server_test.ts`, `cli_test.ts`, `mod_test.ts`
    (FR-E73; regression-locked).
  - [ ] `flowai-workflow mcp <workflow>` starts a server that advertises
    exactly the nine tools above via `tools/list`. Evidence:
    `mcp-server_test.ts::FR-E73 mcp-server registers all nine tools…`.
  - [ ] Integration smoke (manual — korchasa): `npx
    @modelcontextprotocol/inspector` against the running server lists
    tools, calls `list_runs`, calls `tail_artifacts` against a known
    artifact, and returns success on each.



### 3.74 FR-E74: Plugin Self-Contained Runtime (Lazy Compile + Auto-MCP)

- **Description:** Historical contract — the plugin shipped engine
  TypeScript sources plus a Deno-runtime launcher
  (`plugin-src/shared/bin/launch.ts`) that lazily compiled
  `engine/cli.ts` into a host-data-dir cache and spawned the binary
  with forwarded stdio + signals. Superseded by FR-E78: the plugin's
  `.mcp.json` now invokes `flowai-workflow mcp` directly and the
  operator installs the engine binary once on PATH (no launcher, no
  bundled engine TS, no per-host cache).
- **Tasks:** [plugin-self-contained-runtime](../tasks/2026/05/plugin-self-contained-runtime.md), [ts-launcher](../tasks/2026/05/ts-launcher.md), [plugin-ci-mcp-hooks-smoke](../tasks/2026/05/plugin-ci-mcp-hooks-smoke.md), [plugin-binary-fallback](../tasks/2026/06/plugin-binary-fallback.md)
- **Status:** superseded by FR-E78
- **Motivation:** Closed the "everything in the plugin" gap left by
  FR-E70 (sources only) and FR-E73 (no auto-registration). Retired
  because the precondition model (engine on PATH) makes the launcher
  redundant — every plugin user installs `flowai-workflow` anyway.
- **Supersedes:** none
- **Acceptance criteria:** withdrawn; see FR-E78 for the current
  plugin invocation contract.



### 3.78 FR-E78: Plugin Precondition + Release Binary Distribution

- **Description:** The `flowai-workflow` engine binary is a
  documented precondition of the Claude Code / Codex plugin. The
  plugin's `.mcp.json` invokes `flowai-workflow mcp` directly (no
  launcher, no Deno-specific argv, no `${CLAUDE_PLUGIN_ROOT}`
  interpolation). When invoked without a positional argument
  (the plugin's call shape), `cli.ts mcp` resolves the active
  workflow via `resolveActiveWorkflow`: `$FLOWAI_WORKFLOW` →
  exactly-one or `github-inbox` default under
  `<cwd>/.flowai-workflow/` → no-workflow mode (the server registers
  FR-E73 tools and returns a structured missing-workflow diagnostic
  on every call so the MCP handshake still completes). The engine
  itself reads no host-specific env vars; the project-root signal
  comes from `cwd`, which the plugin's `.mcp.json` pins per host
  (`"cwd": "${CLAUDE_PROJECT_DIR}"` for Claude; Codex inherits the
  session cwd by default — no `cwd` field needed). CI publishes pre-compiled engine binaries for
  five targets (Linux x86_64, Linux arm64, macOS x86_64, macOS arm64,
  Windows x86_64; `scripts/targets.json`) as GitHub release assets
  with `.sha256` sidecars; the existing `attach-binaries` job's
  `gh release create … dist/*` glob picks both files up atomically.
  The plugin payload no longer bundles `bin/launch.ts` or the engine
  TS tree (`scripts/build-plugin-payload.ts:classifyPayloadFile`
  returns `null` for both).

  **Failure mode** — if `flowai-workflow` is not on PATH, the MCP
  host surfaces the OS spawn error verbatim and the README install
  section explains the precondition. No retry, no inline download,
  no migration shim.

  **Windows scope** — FR-E78 guarantees only that `flowai-workflow
  mcp` starts and answers `initialize` + `tools/list` on Windows.
  Workflows that use `before`/`after` shell hooks or HITL
  `ask_script`/`check_script` still depend on POSIX `sh`
  (`agent.ts`, `hitl.ts`) and are out of scope (separate FR track).
- **Tasks:** [plugin-binary-fallback](../tasks/2026/06/plugin-binary-fallback.md)
- **Motivation:** The FR-E74 launcher solved a non-problem — every
  plugin user already has `flowai-workflow` installed. Shipping the
  launcher + engine TS bloated the payload, added a cold-start
  compile step, and forced an extra Deno dependency on hosts that
  could install the binary directly. Treating the binary as a
  precondition (like `npx`/`uvx` MCP servers do) matches industry
  norms and shrinks the payload substantially.
- **Dep:** FR-E70, FR-E72, FR-E73
- **Supersedes:** FR-E74
- **Acceptance criteria:**
  - **Tests:** `scripts/build-plugin-payload_test.ts`,
    `scripts/compile_test.ts`, `scripts/ci_yaml_test.ts`,
    `scripts/plugin-install-acceptance_test.ts`, `cli_test.ts`
    (FR-E78; regression-locked).
  - [ ] Manual acceptance (manual — korchasa): in a fresh Claude
    Code session with the plugin installed from a REAL `flowai-workflow`
    binary on PATH (release binary or `deno install -A
    jsr:@korchasa/flowai-workflow`) and a marketplace pointed at the
    SHIPPED payload, `/mcp` lists `flowai-workflow` with the nine
    FR-E73 tools and the first call returns the expected JSON payload.
  - [ ] Manual acceptance (manual — korchasa): a fresh Codex session
    with the plugin installed and `flowai-workflow` on PATH spawns
    the MCP server, lists the nine tools, and runs `get_workflow`
    without error.
  - NB: `deno task sync-plugins-local` rewrites the LOCAL dogfood
    payload's `.mcp.json` to `deno run … src/cli.ts mcp` and does NOT
    exercise the `flowai-workflow` binary — use it for live-source
    dogfood, not for the FR-E78 binary-path verification above.
  - [ ] Release artefact verification (manual — korchasa): the
    GitHub release for the FR-E78-shipping tag contains
    `flowai-workflow-linux-x86_64`, `…-linux-arm64`,
    `…-darwin-x86_64`, `…-darwin-arm64`, `…-windows-x86_64.exe`,
    each accompanied by a `.sha256` sidecar that `sha256sum -c`
    accepts.



### 3.76 FR-E76: Codex Subagent Delivery as Skills

- **Description:** The plugin's operational subagents `orchestrator` and
  `supervisor` reach Codex hosts as **skills**, not agents. The Codex plugin
  manifest exposes only `skills`/`mcpServers`/`apps` component pointers — there
  is no `agents` pointer — so the shared `agents/*.md` (Claude/OpenCode subagent
  format) are inert on Codex. This FR delivers the same operational logic to
  Codex as `SKILL.md` files and wires the dispatchers to use Codex's native
  `worker` subagent for context isolation.

  **Payload routing** (`scripts/build-plugin-payload.ts::classifyPayloadFile`):

  - For `host == "codex"`, files under `plugin-src/shared/agents/` route to
    `null` (dropped — no host loads them on Codex). Claude/OpenCode still
    receive `…/agents/<name>.md` verbatim.
  - Codex operational skills are authored under
    `plugin-src/codex/plugins/flowai-workflow/skills/{orchestrator,supervisor}/SKILL.md`
    and route to the Codex host only via the existing host-prefix arm; the
    Claude payload never contains them.
  - The Codex plugin manifest already declares `skills: "./skills/"` — no
    manifest change.

  **Dispatch (variant B — isolation preserved):** the shared `orchestrate`/
  `supervise` dispatchers gain a Codex branch. The parent spawns a native
  Codex `worker` subagent (Codex `max_depth=1` forbids nested spawns, so the
  parent dispatches) and instructs it, by skill name, to invoke the
  `orchestrator`/`supervisor` skill and return the `SUPERVISOR_DELEGATION` /
  `SUPERVISOR_REPORT` block. The worker — not the parent — performs all policy
  and run-artifact reads. Verified live against `codex-cli 0.135.0`: a Codex
  worker auto-discovers and loads a skill by name in its isolated thread
  (`spawn_agent`/`wait`/`close_agent` collab tools).

- **Tasks:** [codex-subagents-as-skills](../tasks/2026/05/codex-subagents-as-skills.md)
- **Motivation:** Before this FR, `/orchestrate` and `/supervise` dead-ended on
  Codex: the dispatchers offered only Claude/OpenCode branches and the
  operational agents were inert (no `agents` manifest pointer), so the
  "no native subagent dispatch → stop" guard fired even though Codex has
  native `worker` subagents.
- **Dep:** FR-E70, FR-E78
- **Acceptance criteria:**
  - **Tests:** `scripts/build-plugin-payload_test.ts` (FR-E76;
    regression-locked).
  - [x] Manual Codex smoke (manual — korchasa): plugin installed via
    `deno task sync-plugins-local`; in a Codex session `$orchestrate`
    spawns a `worker`, the worker loads the `orchestrator` skill, and
    the loop reaches a `SUPERVISOR_DELEGATION` / `SUPERVISOR_REPORT`
    round. Evidence: Description above — "Verified live against
    `codex-cli 0.135.0`: a Codex worker auto-discovers and loads a
    skill by name in its isolated thread".



### 3.83 FR-E83: Parent-Death Watchdog for stdio MCP Entrypoints

- **Description:** Both long-lived stdio MCP entrypoints —
  `flowai-workflow mcp` (`runMcpServer`, FR-E73) and the internal HITL
  server (`runFlowaiHitlMcpServer`, `--internal-hitl-mcp`) — install a
  cross-platform parent-death watchdog (`src/parent-watchdog.ts`). The
  watchdog polls the parent PID every {@link PARENT_WATCHDOG_INTERVAL_MS}
  (5 s); when the process is reparented to init/launchd (`Deno.ppid === 1`)
  the host that spawned it is gone, so it runs `killAll()` and exits with
  code 143 (128 + SIGTERM).

  Rationale: before this FR the two entrypoints terminated on only stdin
  EOF or SIGTERM/SIGINT. Neither fires when the ACP host dies
  non-gracefully — `kill -9` delivers no SIGTERM, and stdin EOF never
  arrives while any process in the pipe chain still holds the write end
  open (an orphaned `codex-acp`, an intermediate launcher fd dup). The
  server then lingered for days as a `ppid=1` orphan; on the reporting
  host 251 stray processes had accumulated, pinning swap and the memory
  compressor.

  **Invariants:**
  - The watchdog timer is unref'd (`Deno.unrefTimer`) — it never keeps the
    event loop alive on its own; a natural exit is already the desired
    outcome.
  - It fires `onParentDeath` exactly once, then clears its own timer.
  - Installed only on the real stdio path; the test transport branch
    (`options.transport`, `InMemoryTransport`) gets no watchdog.
  - `Deno.ppid` is the portable baseline (covers macOS, the leak host);
    Linux-only `PR_SET_PDEATHSIG` is out of scope.

- **Tasks:** [mcp-orphan-watchdog](../tasks/2026/06/mcp-orphan-watchdog.md)
- **Motivation:** GitHub issue #240 — embedded MCP servers leaked as
  `ppid=1` orphans when the ACP host died non-gracefully, accumulating
  into hundreds of stray processes that pinned swap + the memory
  compressor.
- **Dep:** FR-E73, FR-E78
- **Acceptance criteria:**
  - **Tests:** `parent-watchdog_test.ts` (FR-E83; regression-locked).



### 3.84 FR-E84: MCP `start_run` Tool (Background + Blocking Fresh Run)

- **Description:** The embedded MCP server (FR-E73) gains a ninth tool,
  `start_run`, to begin a FRESH workflow run — closing the one lifecycle gap
  in the tool surface (observe / resume / cancel / patch / answer existed; a
  start did not). The host no longer has to spawn `flowai-workflow run` as a
  background CLI subprocess and scrape the run-id from a log.

  **Tool:** `start_run({ prompt?, wait? })`.
  - `prompt?` — optional extra context forwarded as `args.prompt` (mirrors the
    CLI `--prompt`); it is the ONLY run-input parameter (no `args`/`env`).
  - `wait?` (default `false`) — mode selector.
    - `wait:false` — launch the engine as an **independent detached process**
      (re-exec of the engine binary, child `unref()`) and return
      `{ run_id, pid, wait:false }` immediately; the caller polls `get_state`
      / `tail_artifacts`. The run is independent: it survives the MCP server /
      host dying (the FR-E83 watchdog reaps only the server's own group). This
      lifts the `supervisor` agent's prior `nohup … &` launch into a real tool.
    - `wait:true` — construct the engine in-process, block until completion,
      return `{ run_id, status, total_cost_usd, wait:true }`. The run dies with
      the MCP server if the host exits — the caller chose to wait.

  **Shared core.** Logic lives in `commands.startRun` — the single
  `Engine({resume:false})` construction site, beside `commands.resumeRun`
  (FR-E75), so start behaviour cannot drift between surfaces.

  **Lock / concurrency.** Background start pre-checks the per-workflow lock
  (`lock.liveLockHolder`) and fail-fast rejects when a run is already active
  (FR-E60: no parallel `Engine.run()` per workflow). The blocking path relies
  on the engine's own `acquireLock`.

  **CLI mechanism.** A new fresh-run flag `--run-id <id>` (distinct from
  `--resume`) pins the engine to a caller-allocated id, so background
  `start_run` can return the id before the run completes. `--run-id` combined
  with `--cycles > 1` is rejected (one id cannot span fresh cycles).

  **Spawn portability.** A compiled binary IS the engine, so re-exec is
  `Deno.execPath() run <wf> --run-id <id> …`; under `deno run` (dev/tests,
  `VERSION === "dev"`) the exec is `deno`, so it re-runs `src/cli.ts`. This is
  an explicit environment branch, not an error-recovery fallback.
- **Tasks:** [add-mcp-start-run](../tasks/2026/06/add-mcp-start-run.md)
- **Motivation:** The FR-E73 surface could observe and resume but not start a
  run; starting was left to the `supervisor` agent spawning a background CLI
  and grepping the run-id from a log. SDS §5.7 had deferred the non-blocking
  run-id-then-poll model; this FR realises it for the start path.
- **Dep:** FR-E73, FR-E54, FR-E60, FR-E78
- **Acceptance criteria:**
  - **Tests:** `src/mcp/commands_test.ts`, `src/state/lock_test.ts`,
    `src/cli_test.ts`, `src/mcp/mcp-server_test.ts` (FR-E84;
    regression-locked).



### 3.85 FR-E85: Non-Blocking `resume_node` (`wait` flag)

- **Description:** The MCP `resume_node` tool (FR-E73/E75) gains a `wait`
  parameter so a run can be resumed WITHOUT blocking the MCP request for the
  whole run — the non-blocking counterpart of FR-E84 `start_run`.

  **Tool:** `resume_node({ run_id, wait? })`.
  - `wait?` defaults to `true` — the historical blocking behaviour
    (`commands.resumeRun` → in-process `Engine({resume:true})`, returns the
    final `{ run_id, status, total_cost_usd }`). Back-compatible: existing
    callers are unchanged.
  - `wait:false` — launch the resume as an **independent detached process**
    (`commands.resumeRunBackground`) and return `{ run_id, pid, wait:false }`
    immediately; the caller polls `get_state` / `tail_artifacts`. The detached
    child survives the MCP server / host dying (FR-E83). Rejects when a LIVE
    run already holds the workflow lock (`lock.liveLockHolder`) — that is the
    attach-live case (the engine is already running this run), not a resume.

  **Shared core.** `commands.resumeRun` stays the single blocking
  `Engine({resume:true})` site; `commands.resumeRunBackground` is its
  detached, non-blocking sibling. Both the background start (FR-E84) and the
  background resume share one re-exec builder, `buildEngineRunCommand`, which
  emits `--run-id <id>` for a fresh start and `--resume <id>` for a resume.
- **Tasks:** [supervisor-mcp-wiring](../tasks/2026/06/supervisor-mcp-wiring.md)
- **Motivation:** A supervisor resumes a failed run as often as it starts a
  fresh one. With only a blocking `resume_node`, recovery still required the
  Bash `nohup … --resume &` daemon dance; a non-blocking resume lets the
  supervisor drive recovery through MCP too (SDS §5.7 had deferred this).
- **Dep:** FR-E73, FR-E84
- **Acceptance criteria:**
  - **Tests:** `src/mcp/commands_test.ts`, `src/mcp/mcp-server_test.ts`
    (FR-E85; regression-locked).
