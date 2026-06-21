<!-- section file — index: [documents/design-engine.md](../design-engine.md) -->

# SDS Engine — Embedded MCP Server (FR-E73)

Module: [`mcp-server.ts`](../../mcp-server.ts). Public entry:
`runMcpServer(workflowDir: string, options?: RunMcpServerOptions)`.
Re-exported from `mod.ts`. Dispatched by `cli.ts` via the `mcp`
subcommand (`flowai-workflow mcp <workflow>`).

## 5. Logic

### 5.1 Server bootstrap

`runMcpServer(workflowDir, options)`:

1. Construct `new McpServer({ name: "flowai-workflow", version: VERSION })`.
2. Register the eight tools (one helper per tool, all on the root
   `workflowDir`):
   - `registerGetWorkflow`
   - `registerGetState`
   - `registerListRuns`
   - `registerTailArtifacts`
   - `registerResumeNode`
   - `registerCancelRun`
   - `registerApplyWorkflowPatch`
   - `registerProvideHumanInput` (FR-E75)
3. Branch on transport ownership:
   - When the caller supplies `options.transport` (tests with
     `InMemoryTransport`): `await server.connect(options.transport)`
     and return. The caller owns the lifecycle and is responsible for
     closing the transport.
   - Otherwise (default stdio dispatch from `cli.ts`): construct
     `new StdioServerTransport()`, `await server.connect(transport)`,
     then `await` a `Promise` whose resolve is wired into a
     `transport.onclose` chain (the SDK Protocol may already have
     hooked `onclose`; we wrap rather than overwrite so its cleanup
     still runs).

### 5.2 Tool handlers

**Handler typing constraint.** `server.tool(name, schema, handler)`
relies on conditional inference over the zod schema to type `handler`'s
args. The inference does NOT propagate through a generic wrapper
(`safe<T>(fn: (args: T) => …)`) — wrapping erases the arg type and
TypeScript falls back to `any`, surfacing as TS7006 under `deno check`.
Required pattern: inline `try { … } catch (e) { return err(...) }` per
handler, with explicit per-handler arg annotation
(`async ({ run_id }: { run_id: string }) => { … }`). Cost: ~3 lines of
boilerplate per handler; benefit: full type checking + IDE assist.

All handlers share a common envelope: `try { … } catch (e) { return
err((e as Error).message) }`. `ok(payload)` returns
`{ content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] }`;
`err(msg)` returns `{ isError: true, content: [{ type: "text", text: msg }] }`.

- **`get_workflow()`** — `loadConfig(join(workflowDir, "workflow.yaml"))`
  → `ok(config)`.
- **`get_state({ run_id })`** —
  `replayRunJournal(getRunDir(run_id, workflowDir))` → `ok(state)`.
- **`list_runs()`** — `for await (entry of Deno.readDir(runsDir))`,
  skip non-directories and dotfiles (`.lock`); per run:
  `replayRunJournal` → push `{ run_id, status, total_cost_usd,
  node_count }`. A per-run replay error is caught and pushed as
  `{ run_id, error }` so a single broken journal does not abort the
  call. `Deno.errors.NotFound` on the outer `readDir` (no `runs/`
  yet) collapses to an empty array.
- **`tail_artifacts({ run_id, node_id, filename, lines })`** —
  path = `join(getNodeDir(run_id, node_id, workflowDir), filename)`,
  read text, split on `\n`, strip a single trailing empty entry from
  the file's terminator newline, slice last `lines` entries
  (default 50).
- **`resume_node({ run_id })`** — delegates to
  `commands.resumeRun({ workflowDir, run_id, verbosity: "quiet" })`
  (FR-E75: the single `Engine({resume:true})` construction site,
  shared with CLI `run --resume`), returns `{ run_id, status,
  total_cost_usd }`. Blocks the MCP request for the entire engine run.
- **`provide_human_input({ run_id, node_id, text })`** (FR-E75) —
  delegates to `commands.deliverHumanAnswer({ workflowDir, run_id,
  node_id, text })`. Validates the node is `waiting`, atomically writes
  the local inbox file `<runDir>/.hitl-inbox/<node_id>.txt`, and returns
  `{ inboxPath, live }` (`live` = engine process holding the run lock is
  alive). Write-only: never resumes, never blocks. The live poll loop
  (`hitl.ts`, FR-E75) picks the file up on its next iteration. When
  `live === false` the caller resumes separately via `resume_node`.
- **`cancel_run({ run_id })`** —
  `readLockInfo(defaultLockPath(workflowDir))`. If
  `info.run_id !== run_id` → `err("no matching active run…")`.
  Otherwise `Deno.kill(info.pid, "SIGTERM")` inside a try/catch:
  `Deno.errors.NotFound` and `Deno.errors.PermissionDenied` are
  treated as benign no-ops (process gone between read and kill) and
  surfaced as `{ cancelled: false, pid, reason: "process already
  gone" }`. Other kill errors propagate to the outer envelope.
- **`apply_workflow_patch({ operations })`** — read
  `workflow.yaml`, `parseYaml` to a `Record<string, unknown>`,
  iterate `operations` calling `applyJsonPointerOp(doc, op)` for
  each, `stringifyYaml(doc)`, `Deno.writeTextFile` back. Root
  pointer (`""`, `/`) and `/version` are rejected before any
  mutation. The walker only accepts `add` / `replace` / `remove`
  (the full RFC 6902 surface is out of scope).

### 5.3 JSON-Pointer walker

Internal helper `applyJsonPointerOp(doc, op)` (exported for tests):

1. Reject `op.path` ∈ `{"", "/", "/version"}`.
2. Reject paths not starting with `/`.
3. Split `path.slice(1)` on `/`, decode each token (`~1` → `/`,
   `~0` → `~`; in that order — RFC 6901).
4. Walk every token except the last via `step(parent, token)`:
   - Arrays: parse index, return `parent[idx]`.
   - Objects: return `parent[token]`.
   - Anything else: throw "cannot descend through non-container".
5. Apply the last token through `applyAt(parent, token, op)`:
   - Arrays: `add` with `"-"` token appends; otherwise parse index
     against `length + (op === "add" ? 1 : 0)`. `remove` →
     `splice(idx, 1)`; `replace` → `parent[idx] = value`; `add` →
     `splice(idx, 0, value)`.
   - Objects: `remove`/`replace` require the key to exist;
     `add` sets unconditionally.

### 5.4 Transport selection

- **stdio** (default, dispatched by `cli.ts mcp`): the SDK's
  `StdioServerTransport` keeps the event loop alive while stdin is
  open. The `onclose` chain resolves the outer Promise on stdin EOF,
  so the CLI exits cleanly with `Deno.exit(0)`. A parent-death watchdog
  (FR-E83, `parent-watchdog.ts` — see SDS §3.3c) is installed on this
  path only and stopped on transport close, so an abruptly-killed host
  (no SIGTERM, no EOF) does not leave the server orphaned.
- **InMemoryTransport** (tests): paired via
  `InMemoryTransport.createLinkedPair()`. The server returns
  immediately after `server.connect(transport)` so the test can
  drive `client.callTool(...)` calls without waiting on the
  transport's lifecycle.
- **Future HTTP/SSE**: deferred follow-up. Replacing the
  `StdioServerTransport` constructor with `new HttpServerTransport(...)`
  (or similar) requires zero changes inside the seven handlers — the
  schema/handler contracts are transport-agnostic.

### 5.5 Process model invariants

- No OS signal handlers installed inside `runMcpServer` (FR-E61).
  The CLI installs once at top-of-`if (import.meta.main)` for the
  whole process (`installSignalHandlers()` is now hoisted in
  `cli.ts` and removed from `runEngine`).
- Per-run `PhaseRegistry` (FR-E59): each `resume_node` call
  constructs its own `Engine`, which builds a fresh `PhaseRegistry`
  internally. No module-level state in `mcp-server.ts`.
- Sequential `Engine.run()` (FR-E60): concurrent `resume_node` calls
  for the same workflow folder are serialised by the existing
  per-workflow run lock (`defaultLockPath(workflowDir)` +
  `acquireLock`). `mcp-server.ts` does NOT add a second lock layer.
- Read-only tools (`get_workflow`, `get_state`, `list_runs`,
  `tail_artifacts`) never acquire the run lock; they read journals
  and artifacts directly.

### 5.6 Error mapping

- Tool-level errors (handler `throw` or explicit `err(msg)`) surface
  as MCP `{ isError: true, content: [...] }`. The transport stays
  up, and subsequent tool calls work.
- Transport-level errors (stdio closed mid-write, socket reset)
  propagate to `runMcpServer`'s outer awaits and bubble out of the
  function. The CLI surfaces them as a non-zero exit code.

### 5.7 Out of scope (deferred)

- HTTP/SSE transport implementation.
- `createMcpServer()` factory returning a configured `McpServer`
  for embedded hosts.
- Migrating `hitl-mcp-server.ts` (hand-rolled NDJSON) onto the SDK.
- Auth / authz on the MCP surface (stdio is local-only).
- Non-blocking `resume_node` variant (run-id-then-poll model).
