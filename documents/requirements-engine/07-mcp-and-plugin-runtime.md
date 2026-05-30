<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — MCP Server and Plugin Runtime

Embedded MCP server (FR-E73) and the plugin's self-contained runtime
that auto-registers it (FR-E74). Both depend on FR-E70 (plugin payload
shape) but are kept here to fit within the per-file token budget.


### 3.73 FR-E73: Embedded MCP Server Over Engine

- **Description:** The engine exposes an embedded Model Context Protocol
  (MCP) server with seven engine-control tools, accessible via the
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
  - `resume_node({ run_id })` — construct `new Engine({ resume: true,
    run_id, ... }).run()` and return the final `RunState` summary. Blocks
    until the engine completes (may take minutes).
  - `cancel_run({ run_id })` — read the workflow lock, send SIGTERM to the
    holder. Rejects when `lockInfo.run_id !== run_id`. Treats
    `Deno.errors.NotFound` and `PermissionDenied` from `Deno.kill` as a
    benign no-op (process already gone between read and kill).
  - `apply_workflow_patch({ operations })` — apply add/replace/remove ops
    (JSON Pointer paths per RFC 6901) to `workflow.yaml`. Rejects ops
    targeting the root or the `version` key. Caveat: `@std/yaml` round-
    trip drops comments and may normalise quoting.

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
    exactly the seven tools above via `tools/list`. Evidence:
    `mcp-server_test.ts::FR-E73 mcp-server registers all seven tools…`.
  - [ ] Integration smoke (manual — korchasa): `npx
    @modelcontextprotocol/inspector` against the running server lists
    tools, calls `list_runs`, calls `tail_artifacts` against a known
    artifact, and returns success on each.



### 3.74 FR-E74: Plugin Self-Contained Runtime (Lazy Compile + Auto-MCP)

- **Description:** The Claude Code / Codex plugin ships engine
  TypeScript sources plus a Deno-runtime launcher
  (`plugin-src/shared/bin/launch.ts`). On first invocation the launcher
  compiles `engine/cli.ts` via `deno compile` into the host data dir
  (`CLAUDE_PLUGIN_DATA`, `FLOWAI_PLUGIN_DATA`, `CODEX_HOME`, or `HOME`
  fallback; atomic via `Deno.rename` from a `.tmp.<pid>` sibling) and
  spawns the cached binary with forwarded stdio + SIGINT/SIGTERM.
  Subsequent invocations stat-check the cached binary and skip compile.
  Plugin payloads also contain host-specific MCP config:
  Claude `plugins/flowai-workflow/.mcp.json` invokes
  `${CLAUDE_PLUGIN_ROOT}/bin/launch.ts`; Codex
  `plugins/flowai-workflow/.mcp.json` invokes `./bin/launch.ts` with
  `cwd = "."` so the stdio server starts from the plugin root. Both
  register the `flowai-workflow` MCP server for the embedded MCP
  surface (FR-E73 seven tools). The host needs Deno on PATH (the same
  dependency the rest of the engine already requires) — no separate
  POSIX-shell or Python tooling. Launcher
  resolves the active workflow at spawn time via `$FLOWAI_WORKFLOW` →
  `$CLAUDE_PROJECT_DIR/.flowai-workflow/<single-or-default>` →
  `--no-workflow` (`cli.ts mcp --no-workflow` starts the server in
  no-workflow mode where every tool handler returns a structured
  missing-workflow diagnostic so the MCP handshake still completes
  and Claude Code surfaces the actionable "run /flowai-workflow:init"
  message via the standard tool-error path rather than an opaque
  spawn failure).
- **Tasks:** [plugin-self-contained-runtime](../tasks/2026/05/plugin-self-contained-runtime.md), [ts-launcher](../tasks/2026/05/ts-launcher.md), [plugin-ci-mcp-hooks-smoke](../tasks/2026/05/plugin-ci-mcp-hooks-smoke.md)
- **Motivation:** Closes the "everything in the plugin" gap left by
  FR-E70 (sources only) and FR-E73 (no auto-registration). The user
  installs the plugin once and the IDE wires both CLI invocations
  (`/flowai-workflow:run` skill etc.) and the MCP server
  automatically. No separate `deno install`, no GitHub-Release
  binary download, no hand-edited `~/.codex/config.toml`.
- **Acceptance criteria:**
  - **Tests:** `scripts/launch_test.ts`,
    `scripts/build-plugin-payload_test.ts`, `mcp-server_test.ts`,
    `cli_test.ts` (FR-E74; regression-locked).
  - [x] Launcher caches the compiled binary at
    `${CLAUDE_PLUGIN_DATA}/bin/flowai-workflow-<version>`; first call
    invokes `deno compile`, second call skips it. Evidence:
    `scripts/launch_test.ts::FR-E74 launcher compiles on first call and caches by version`.
  - [x] Plugin payload includes the launcher `bin/launch.ts`.
    Evidence:
    `scripts/build-plugin-payload_test.ts::FR-E74 payload includes launcher`.
  - [x] Plugin payload includes host-specific MCP config declaring
    `command = "deno"`: Claude uses
    `${CLAUDE_PLUGIN_ROOT}/bin/launch.ts`; Codex uses plugin-root
    `.mcp.json` with `cwd = "."` and `./bin/launch.ts`, and contains
    no `CLAUDE_PLUGIN_ROOT` reference.
    Evidence:
    `scripts/build-plugin-payload_test.ts::FR-E74 claude payload includes Claude MCP wiring`,
    `scripts/build-plugin-payload_test.ts::FR-E74 codex payload includes Codex MCP wiring without Claude env`.
  - [x] Launcher forwards SIGTERM/SIGINT to the spawned engine
    binary (installed before any `await` to close the cold-start
    race). Evidence:
    `scripts/launch_test.ts::FR-E74 launcher forwards SIGTERM to child binary`.
  - [x] `cli.ts mcp --no-workflow` dispatches the MCP server in
    no-workflow mode; the server registers all seven tool names but
    every handler returns a structured missing-workflow diagnostic
    referencing `init`. Evidence:
    `mcp-server_test.ts::FR-E74 server starts in no-workflow mode and surfaces missing-workflow error on tool call`.
  - [ ] CI smoke executes the exact MCP command declared by the
    installed Codex cache's `.mcp.json`, sends MCP `initialize` and
    `tools/list`, and verifies the `flowai-workflow` server plus the
    expected FR-E73 tool names. Evidence:
    `scripts/plugin-install-smoke_test.ts::FR-E74 installed codex mcp config completes initialize and tools list`.
  - [ ] CI smoke executes the exact MCP command declared by the
    installed Claude plugin root's `.mcp.json`, sends MCP `initialize`
    and `tools/list`, and verifies the `flowai-workflow` server plus
    the expected FR-E73 tool names. Evidence:
    `scripts/plugin-install-smoke_test.ts::FR-E74 installed claude mcp config completes initialize and tools list`.
  - [ ] Manual smoke (manual — korchasa): in a fresh Claude Code
    session with the plugin installed via `deno task
    sync-plugins-local`, `/mcp` lists `flowai-workflow` with the
    seven tools; the first call compiles the binary into
    `${CLAUDE_PLUGIN_DATA}/bin/` and subsequent calls run instantly.
