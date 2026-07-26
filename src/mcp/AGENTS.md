# Module: mcp

The engine's outward control surface: nine MCP tools plus the shared
command core the CLI uses for the same operations.

- `mcp-server.ts` — tool registration over a generic transport (stdio by
  default). Handlers parse and serialise; they hold no logic.
- `commands.ts` — `startRun`, `resumeRun`, `resumeRunBackground`,
  `deliverHumanAnswer`. The single construction sites for `Engine`.

## Key decisions

- **MCP is a THIN interface.** Anything an operator can do from both the host
  IDE and the terminal lives in `commands.ts`, so the two surfaces cannot
  drift.
- **This is the trust boundary.** `run_id`, `node_id` and `filename` arrive
  from a model and are validated with `assertSafeSegment` /
  `assertSafeRelativePath` before touching a path helper — `join` normalises
  `..`, which turned `tail_artifacts` into an arbitrary file read.
- **Background start/resume re-exec the engine detached** (`child.unref()`),
  so a run outlives the MCP server and the host process.
- **The per-workflow run lock is the only serialisation layer.** `start_run`
  and `resumeRunBackground` pre-check it and fail fast rather than spawning a
  process doomed to lose the lock.
- **No-workflow mode registers all nine tool names** so the handshake
  completes and the operator gets an actionable diagnostic per call.
- **No signal handlers here** — the CLI owns signal routing (FR-E61).
