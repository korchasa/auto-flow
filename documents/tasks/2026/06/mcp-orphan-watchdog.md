---
implements:
  - FR-E83  # Parent-Death Watchdog for stdio MCP entrypoints
---
# MCP servers leak as orphans (ppid=1) when ACP host dies non-gracefully

GitHub issue: https://github.com/korchasa/flowai-workflow/issues/240
Scope: engine. Labels: bug, priority: high, scope: engine.

## Goal

Stop the embedded MCP servers (`mcp` and `--internal-hitl-mcp`) from lingering
for days as `ppid=1` orphans after the ACP host that spawned them dies
non-gracefully (SIGKILL / crash / orphaning). Observed leak: 251 stray
flowai-workflow processes pinning swap + memory compressor on a single dev
host.

## Overview

### Context

Both stdio MCP entrypoints terminate on only two signals:

1. **stdin EOF** — `StdioServerTransport.onclose` (`src/mcp/mcp-server.ts`) /
   the `for await … Deno.stdin.readable` loop end (`src/hitl/hitl-mcp-server.ts`).
2. **SIGTERM/SIGINT** — `src/process-registry.ts::installSignalHandlers`.

Neither fires when the parent dies abruptly: `kill -9` delivers no SIGTERM, and
stdin EOF never arrives while any process in the pipe chain still holds the
write end open (orphaned `codex-acp`, intermediate launcher fd dup). There is
no parent-death watchdog anywhere in the lifecycle code. Result: server runs
forever.

The owner's rescope comment (2026-06-21) re-points the fix surface to the
post-ACP layout: `bin/launch.ts` is gone (FR-E78); the MCP entrypoint is now
`flowai-workflow mcp` resolved inside `cli.ts mcp` → `runMcpServer`, plus the
HITL server `runFlowaiHitlMcpServer`.

### Current State

- `src/mcp/mcp-server.ts::runMcpServer` — default stdio branch connects a
  `StdioServerTransport` and awaits an `onclose`-wired promise. No watchdog.
- `src/hitl/hitl-mcp-server.ts::runFlowaiHitlMcpServer` — reads stdin until EOF.
  No watchdog.
- `src/process-registry.ts` — exposes `killAll()` (re-exported from
  `@korchasa/ai-ide-cli`) and `installSignalHandlers()` (bin-only).
- Deno exposes the parent PID directly via `Deno.ppid`, and `Deno.unrefTimer`
  to keep a poll timer from holding the event loop open on its own.

### Constraints

- Cross-platform baseline (must cover macOS — the leak host). `Deno.ppid` poll
  is portable; Linux-only `PR_SET_PDEATHSIG` is explicitly out of scope.
- Must NOT keep the process alive by itself (unref the timer) — a natural exit
  is already the desired outcome.
- Must not break the test transport path (`options.transport`,
  `InMemoryTransport`) — only the real stdio path gets the watchdog.
- Engine stays domain-agnostic; this is pure process-lifecycle hardening.

## Definition of Done

- [x] New module `src/parent-watchdog.ts`: `parentIsOrphaned(getParentPid)` +
  `installParentDeathWatchdog(options)` returning `{ stop() }`.
- [x] `runMcpServer` stdio branch installs the watchdog and stops it on
  transport close.
- [x] `runFlowaiHitlMcpServer` installs the watchdog and stops it in `finally`.
- [x] Tests `src/parent-watchdog_test.ts` (FR-E83): orphan detection, fires
  once on reparent, never fires while parent alive, `stop()` cancels, and
  source-wiring presence in both entrypoints.
- [x] FR-E83 added to SRS section 07 + index map; SDS subsystem note added.
- [x] `deno task check` exits 0.

## Solution

1. **RED** — write `src/parent-watchdog_test.ts` with FR-E83 tests:
   - `parentIsOrphaned(() => 1)` is true; `parentIsOrphaned(() => 4242)` false.
   - `installParentDeathWatchdog` with injected `getParentPid: () => 1`, tiny
     `intervalMs`, custom `onParentDeath` counter — fires exactly once across
     multiple ticks (interval self-clears on fire).
   - With `getParentPid` returning a live pid — never fires.
   - `stop()` before any tick — never fires.
   - Source-presence: `mcp-server.ts` and `hitl-mcp-server.ts` text includes
     `installParentDeathWatchdog`.
2. **GREEN** — create `src/parent-watchdog.ts`:
   - `const INIT_PID = 1; export const PARENT_WATCHDOG_INTERVAL_MS = 5_000;`
   - `parentIsOrphaned(getParentPid = () => Deno.ppid) => getParentPid() === INIT_PID`.
   - `installParentDeathWatchdog({ intervalMs?, getParentPid?, onParentDeath? })`:
     `setInterval` polling `parentIsOrphaned`; on true → set `fired`,
     `clearInterval`, call `onParentDeath`. `Deno.unrefTimer(timer)`. Return
     `{ stop: () => clearInterval(timer) }`. Default `onParentDeath` =
     `killAll().finally(() => Deno.exit(143))`.
3. **Wire entrypoints**:
   - `mcp-server.ts` stdio branch: `const watchdog = installParentDeathWatchdog();`
     after `server.connect`; `watchdog.stop()` after the onclose promise.
   - `hitl-mcp-server.ts`: wrap the read loop in `try { … } finally {
     watchdog.stop() }`.
4. **REFACTOR** — JSDoc module headers, tidy.
5. **Docs** — add FR-E83 to `documents/requirements-engine/07-mcp-and-plugin-runtime.md`
   + index map in `documents/requirements-engine.md`; add a watchdog subsystem
   note to `documents/design-engine/03-subsystems.md` and a pointer from
   `05-mcp-server.md` §5.5.
6. **CHECK** — `deno task check` exits 0.
</content>
</invoke>
