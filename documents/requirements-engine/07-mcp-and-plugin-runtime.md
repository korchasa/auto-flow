<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — MCP Server and Plugin Runtime

Embedded MCP server (FR-E73), the plugin's self-contained runtime that
auto-registers it (FR-E74, superseded by FR-E78), Codex subagent
delivery as skills (FR-E76), and the engine binary precondition +
release distribution model (FR-E78). All depend on FR-E70 (plugin
payload shape) but are kept here to fit within the per-file token
budget.


### 3.73 FR-E73: Embedded MCP Server Over Engine

- **Description:** The engine exposes an embedded Model Context Protocol
  (MCP) server with eight engine-control tools (the eighth,
  `provide_human_input`, added by FR-E75), accessible via the
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
    exactly the eight tools above via `tools/list`. Evidence:
    `mcp-server_test.ts::FR-E73 mcp-server registers all eight tools…`.
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
    Code session with the plugin installed via `deno task
    sync-plugins-local` and `flowai-workflow` on PATH, `/mcp` lists
    `flowai-workflow` with the seven FR-E73 tools and the first call
    returns the expected JSON payload.
  - [ ] Manual acceptance (manual — korchasa): a fresh Codex session
    with the plugin installed and `flowai-workflow` on PATH spawns
    the MCP server, lists tools, and runs `get_workflow` without
    error.
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
