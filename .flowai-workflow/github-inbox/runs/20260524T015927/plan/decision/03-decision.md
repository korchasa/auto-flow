---
variant: "Variant B: @modelcontextprotocol/sdk library-based server"
tasks:
  - desc: "Add npm:@modelcontextprotocol/sdk dependency to deno.json imports"
    files: ["deno.json"]
  - desc: "Implement mcp-server.ts with McpServer instance, 7 tool registrations via server.tool(), StdioServerTransport"
    files: ["mcp-server.ts"]
  - desc: "Add 'mcp' case to cli.ts subcommand routing (FR-E45 dispatch)"
    files: ["cli.ts"]
  - desc: "Re-export MCP server entry point from mod.ts"
    files: ["mod.ts"]
  - desc: "Write mcp-server_test.ts — unit tests for each tool handler + integration test via InMemoryTransport"
    files: ["mcp-server_test.ts"]
  - desc: "Document mcp subcommand and 7 tool signatures in README.md"
    files: ["README.md"]
---

## Justification

I selected Variant B over A and C for the following reasons:

**Against Variant A (hand-rolled JSON-RPC 2.0):** The existing HITL MCP
server (`hitl-mcp-server.ts`) uses a minimal NDJSON/stdio pattern that works
for a single tool, but hand-rolling JSON-RPC 2.0 for 7 tools with typed
schemas risks missing edge cases (batched requests, cancellation, progress
notifications). More critically, it blocks future transport modes (HTTP/SSE)
which would require a second, parallel implementation. AGENTS.md vision states
the engine is "library-embedding-ready" (FR-E59/E60/E61) — a hand-rolled
protocol server contradicts the direction of standard, extensible interfaces.

**Against Variant C (library-first factory API):** While `createMcpServer()`
aligns with the embedding vision, it inflates scope by requiring a stable
public API surface (`createMcpServer` options, transport interface) before the
tool set is validated. The project vision prioritizes domain-agnostic
execution over premature abstraction — the `createMcpServer` factory can be
extracted from Variant B's implementation in a follow-up FR once the tool set
stabilizes. "Three similar lines is better than a premature abstraction."

**Why Variant B:** The official `@modelcontextprotocol/sdk` gives
spec-compliant protocol handling, typed tool registration via `server.tool()`,
and a clean path to HTTP/SSE transport with zero server code changes. Testing
benefits from `InMemoryTransport` (no subprocess spawn). The npm dependency is
the standard SDK endorsed by the MCP spec, and `deno compile` compatibility
must be verified (task #1 blocker check) but is expected to work given Deno's
npm compat layer. The HITL server remains hand-rolled for now — unifying it is
a natural follow-up.

## Task Descriptions

### Task 1: Add SDK dependency
Add `npm:@modelcontextprotocol/sdk` to `deno.json` imports. Verify
`deno compile` compatibility with a dry-run compile. This is the blocking
prerequisite — if the dependency breaks `deno compile`, the variant must be
reconsidered.

### Task 2: Implement mcp-server.ts
New module. Create `McpServer` instance with 7 tool registrations:
- `get_workflow` — calls `loadConfig()`, returns `WorkflowConfig` JSON.
- `get_state` — calls `replayRunJournal()`, returns `RunState` JSON.
- `list_runs` — reads `<workflowDir>/runs/` directory, replays each run's
  journal, returns array of run summaries.
- `tail_artifacts` — reads artifact file from node directory, returns last N
  lines.
- `resume_node` — spawns `Engine` with `resume: true` for the given run-id.
- `cancel_run` — reads lock info via `readLockInfo()`, sends SIGTERM to PID.
- `apply_workflow_patch` — reads YAML, applies JSON patch, writes back.

Export `runMcpServer(workflowDir)` function that creates server +
`StdioServerTransport` and connects them.

### Task 3: Add CLI subcommand
Add `"mcp"` case to the existing subcommand `switch` in `cli.ts`, calling
`runMcpServer()` from `mcp-server.ts`. The subcommand takes `<workflow>` as
mandatory positional argument (same pattern as `run` and `init`).

### Task 4: Re-export from mod.ts
Add `export { runMcpServer } from "./mcp-server.ts"` to the barrel module.

### Task 5: Write tests
Unit tests for each of the 7 tool handlers using temp directories with fixture
data. Integration test using SDK's `InMemoryTransport` — no subprocess needed.
Test `cancel_run` sends SIGTERM through PID from lock info. All tests follow
existing `*_test.ts` naming convention.

### Task 6: Document in README
Add `mcp` subcommand to CLI reference. Document 7 tool signatures with
parameter schemas and return types. Include usage example for Claude Desktop
MCP config.

## Summary

Selected Variant B (`@modelcontextprotocol/sdk` library-based server) for
FR-E70. The SDK provides spec-compliant MCP protocol handling with typed tool
registration and transport extensibility, avoiding hand-rolled JSON-RPC edge
cases while keeping scope contained (no premature library-first API surface).
6 tasks ordered by dependency. Branch `sdlc/issue-221` created, draft PR
opened with SDS updates.
