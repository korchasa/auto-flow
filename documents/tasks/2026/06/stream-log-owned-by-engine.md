---
date: "2026-06-02"
status: done
implements: [FR-E18, FR-E20]
tags: [observability, library-boundary, stream-log, acp]
related_tasks:
  - 2026/06/engine-warn-on-runtime-degraded-options.md
  - 2026/06/acp-codex-transport-issues-report.md
  - 2026/05/budget-cli-runtime-coupling.md
  - 2026/05/hitl-detection-boundary.md
  - 2026/05/isolation-provider.md
---
# Engine owns the per-node stream-log file write

## Goal

Make `flowai-workflow` (engine) the sole writer of the per-node events
file (`${node_dir}/stream.log`). Under the current ACP-only runtime
(FR-E77) the file is **not written by anyone**: the `@korchasa/ai-ide-cli`
ACP path ignores `streamLogPath`, and the engine does not subscribe to
the library's raw event stream. Restoring the file in the engine (a)
brings back FR-E18 timestamps and FR-E20 repeated-read warnings that the
ACP migration silently dropped, and (b) lands the file write on the
correct side of the boundary the project has been tightening for HITL,
budget, and isolation: library = transport + raw runtime events, engine
= workflow policy + on-disk artefacts.

## Overview

### Context

- Per-node events file path: `${node_dir}/stream.log`, computed in
  `src/engine/node-dispatch.ts:150` and again in `src/engine/loop.ts:219`
  as `${workPath(ctx.workDir, ctx.node_dir)}/stream.log` (FR-E52
  workDir-relative wrap). Threaded through `runAgent`
  (`src/engine/agent.ts:133,207,333,505`) into the runtime adapter as
  `RuntimeInvokeOptions.streamLogPath`.
- **ACP migration changed everything.** Commit `61f948e`
  (2026-06-05, "refactor(engine): src/ layout + external
  @korchasa/ai-ide-cli (ACP-only)") moved the engine to drive the
  library **ACP-only** (FR-E77): every `adapter.invoke()` passes
  `transport: "acp"` (`src/engine/agent.ts:315,488`). The task itself
  predates this commit (dated 2026-06-02), so its original framing
  ("the library opens the fd and appends every line") describes the
  now-dead CLI subprocess path.
- **Under ACP the library writes nothing to disk.** In the published
  `@korchasa/ai-ide-cli@0.8.8`:
  - `claude-adapter.ts::invoke` branches
    `if (opts.transport === "acp") return invokeViaAcp(...)` before ever
    reaching the CLI writer (`invokeClaudeCli`, which still accepts
    `streamLogPath`).
  - `runtime/acp/*` (`adapter.ts`, `client.ts`, `mapping.ts`,
    `content.ts`, `fronts.ts`) contain **zero** disk writes — no
    `streamLogPath`, no `writeFile`/`openSync`, no `stampLines`. The ACP
    invoke path (`invokeViaAcp`) only forwards events via
    `safeInvokeCallback(opts.onEvent, [note.params ?? {}], ...)`.
  - The old formatter (`--- turn N ---`, `[HH:MM:SS]`, `[stream]
    text:/tool:`, footer, FR-E20 warning) lives in the CLI-path
    `claude/stream.ts` and is **not reusable for ACP** — ACP events are
    raw JSON-RPC `session/update` params (`{sessionUpdate: ...}`),
    a different shape than Claude CLI NDJSON.
- **The drop is already a known, documented degradation.** FR-E79
  (`src/engine/agent.ts:271-281`) surfaces the library's
  `reportDegradedOptions` (`runtime/acp/adapter.ts`) as a node-tagged
  engine WARN; the SRS FR-E79 block explicitly lists "`streamLogPath`
  dropped" among the ACP degraded options. So the library is honest
  about not persisting the file; nothing on the engine side closes the
  gap.
- **Live event surface the engine can subscribe to.** The invoke path
  forwards `onEvent: (event: Record<string, unknown>) => void`
  (`runtime/adapter-types.ts:149`) with the raw ACP `session/update`
  `params` for every notification. The engine passes **no** `onEvent`
  today (`src/engine/agent.ts:311-339` lists `onOutput`,
  `onCallbackError`, `streamLogPath` — but not `onEvent`).
- **Public content extractor.** `extractSessionContent(event)`
  (export `@korchasa/ai-ide-cli/runtime/content`) routes ACP-shaped
  events through `extractAcpContent` and returns typed items
  (`kind: "text" | "tool" | "final"`). The engine can wrap the raw
  `params` as `{ runtime, type: "session/update", raw: params }` and
  call this public helper instead of hand-parsing ACP JSON — keeping
  content *parsing* in the library (a transport concern) while the
  engine owns *formatting + persistence*.
- **Dashboard does NOT parse stream.log structure.**
  `scripts/generate-dashboard.ts::readStreamLog` (`scripts/generate-dashboard.ts:50-69`)
  does `Deno.readTextFile` + head/tail line truncation and renders the
  text inside `<pre>` (`:174,:178`). No turn-marker or `[stream]`-prefix
  parsing. So the on-disk contract is "human-readable text", not a
  byte-exact format.
- Engine-side invariants in scope:
  - FR-E18 (stream-log timestamps) — every non-empty persisted line is
    `[HH:MM:SS]`-prefixed; terminal `onOutput` is NOT prefixed.
  - FR-E20 (repeated file-read warning) — `[WARN] repeated file read:
    <path> (<N> times)` on >2 Read tool_use hits of the same path within
    one node run.
- **Stale docs to fix in scope:**
  - FR-E18 Description references `…/runs/<run-id>/logs/<node-id>.jsonl`
    (`documents/requirements-engine/05-cli-and-observability.md:71`);
    real path is `${node_dir}/stream.log`.
  - FR-E18/E20 `**Tests:**` anchors point at `agent_test.ts` line ranges
    (`391-442`, `790-855`) and symbols (`stampLines`, `tsPrefix`,
    `FileReadTracker`) that **no longer exist in the engine** — they
    left with the library externalization. The "regression-locked"
    claim is currently false; this task re-establishes engine tests and
    repoints the anchors.
- Boundary precedents: `2026/05/isolation-provider.md`,
  `2026/05/budget-cli-runtime-coupling.md`,
  `2026/05/hitl-detection-boundary.md`,
  `2026/06/engine-warn-on-runtime-degraded-options.md` (FR-E79).

### Current State

- `${node_dir}/stream.log` is **not produced** during ACP runs. The
  newest files on disk are May (pre-migration), written by the dead CLI
  path. No June `stream.log` exists.
- The engine computes `streamLogPath` and forwards it through `runAgent`
  into `adapter.invoke({ transport: "acp", …, streamLogPath })`, where
  it is silently dropped (and reported once per node as an FR-E79
  degraded-option WARN).
- Formatting + timestamping + FR-E20 tracking exist ONLY in the library
  CLI path (`claude/stream.ts`); the engine has no copy.
- `runAgent` already owns the callback plumbing pattern: it builds
  `onOutput` and `onCallbackError` from `OutputManager`
  (`src/engine/agent.ts:266-281`) but no `onEvent`. The continuation
  loop reuses the same options across initial + every `--resume`
  (`src/engine/agent.ts:344,486`).
- Test harness: `agent_test.ts` injects a mock `RuntimeAdapter` whose
  `invoke(opts)` can call `opts.onEvent` / `opts.onCallbackError`
  (see FR-E79 test at `src/engine/agent_test.ts:514-589`) — the RED
  fixture for the new writer slots into this exact pattern.

### Constraints

- **Engine-only change (Variant A).** No `@korchasa/ai-ide-cli` change,
  no JSR republish, no pin bump. The library's existing public surface
  (`onEvent` + `extractSessionContent`) is sufficient.
- **On-disk contract relaxed to "human-readable".** The May byte-shape
  cannot be reproduced byte-for-byte (ACP events ≠ CLI NDJSON) and need
  not be: the dashboard does no structural parse. Preserve the
  *behaviours* FR-E18 (timestamps) and FR-E20 (repeated-read warning)
  and keep output `tail -f`-friendly; structural continuity
  (`--- turn N ---`, `[stream] text:/tool:`) is best-effort, not a hard
  parse contract.
- **Path stays workDir-relative (FR-E52/FR-E57).** Open the writer at
  the already-wrapped `streamLogPath` from
  node-dispatch/loop (relative to engine cwd, inside the worktree). Do
  not re-wrap.
- **Resume semantics.** One file handle (or append re-open) kept alive
  across the initial invoke AND every continuation for the same node —
  append, never truncate between attempts.
- **Fail-fast.** A filesystem error opening/writing the events file
  aborts the node with a clear `cli_crash`-category error, not a
  swallowed exception (AGENTS.md "fail fast, fail clearly").
- **No spurious WARN.** Stop sending `streamLogPath` to `adapter.invoke`
  once the engine owns the write — otherwise FR-E79 keeps reporting it
  as a dropped degraded option on every node.

## Definition of Done

- [x] **FR-E18** — `stampLines`/`tsPrefix` reintroduced in the engine:
  every non-empty line written to `stream.log` is `[HH:MM:SS]`-prefixed;
  empty lines pass through unprefixed.
  - Test: `src/engine/stream-log_test.ts::FR-E18 stampLines prefixes non-empty lines and passes empty lines through`
  - Evidence: `deno task check`
- [x] **FR-E18** — `runAgent` wires `onEvent` → engine stream-log writer
  on BOTH the initial and every `--resume` invoke, and no longer passes
  `streamLogPath` to `adapter.invoke` (no FR-E79 degraded-option WARN for
  the events file).
  - Test: `src/engine/agent_test.ts::FR-E18 engine persists ACP onEvent stream to stream.log`
  - Evidence: `deno task check`
- [x] **FR-E18** — writer keeps a single append handle across initial +
  continuation invokes (resume appends, does not truncate prior turns).
  - Test: `src/engine/agent_test.ts::FR-E18 stream.log appended across continuations`
  - Evidence: `deno task check`
- [x] **FR-E18** — FS open/write failure fails the node fast with
  `error_category: "cli_crash"` and a clear message (not swallowed).
  - Test: `src/engine/agent_test.ts::FR-E18 stream-log open failure fails node with cli_crash`
  - Evidence: `deno task check`
- [x] **FR-E20** — engine `FileReadTracker` emits
  `[WARN] repeated file read: <path> (<N> times)` into `stream.log` when
  a `Read` tool targets the same path >2 times within one node run;
  per-path independent; resets per node.
  - Test: `src/engine/stream-log_test.ts::FR-E20 FileReadTracker warns after more than 2 reads of same path`
  - Evidence: `deno task check`
- [x] **FR-E18** — extracted `text`/`tool`/`final` lines come from the
  library's public `extractSessionContent` (engine wraps raw ACP
  `params`) and are written as `[stream] text:/tool:/result:`. Turn
  markers are best-effort/optional and NOT asserted.
  - Test: `src/engine/stream-log_test.ts::FR-E18 formats ACP session/update params into text and tool lines`
  - Evidence: `deno task check`
- [x] **FR-E18** — SRS FR-E18 stale path string
  (`…/logs/<node-id>.jsonl` → `${node_dir}/stream.log`) fixed and
  FR-E18/E20 `**Tests:**` anchors repointed to the new engine tests.
  - manual — korchasa (doc edit)
  - Evidence: `git diff documents/requirements-engine/05-cli-and-observability.md`
- [x] **FR-E18 / FR-E20** — `documents/index.md` gains FR-E18 and FR-E20
  rows under `## FR`.
  - manual — korchasa (doc edit)
  - Evidence: `git diff documents/index.md`

## Solution

Selected variant: **A — engine writes `stream.log` from the ACP
`onEvent` stream; formatter lives in the engine; no library change.**

### Files

- **NEW `src/engine/stream-log.ts`** — engine-owned writer + formatter:
  - `tsPrefix(d: Date): string` → `[HH:MM:SS]` (24h, zero-padded).
  - `stampLines(text: string): string` — prefix each non-empty line;
    empty lines pass through. (Re-introduces the symbols FR-E18 lost to
    the library externalization.)
  - `class FileReadTracker { track(path: string): string | null }` —
    returns the `[WARN] repeated file read: <path> (<N> times)` line when
    count > 2, else `null`. Per-path counters; instance scoped to one
    node run (FR-E20).
  - `createStreamLogWriter(path: string): StreamLogWriter` where
    `StreamLogWriter = { handleEvent(params): void; takeWriteError(): Error | null; close(): Promise<void> }`.
    - Opens `path` once with `Deno.open(path, { create: true, append: true })`.
      A failure throws a typed error (caught by `runAgent`, mapped to
      `cli_crash`).
    - **Serialized async writes (critique #5).** The invoke-path
      `onEvent` is fired WITHOUT await (`acp/adapter.ts:525`), so
      `handleEvent` must NOT return a floating promise. It synchronously
      appends to an internal promise-chain (`tail = tail.then(write)`) to
      preserve line order, and captures the first rejection into a
      private field exposed via `takeWriteError()`. `runAgent` calls
      `takeWriteError()` after each invoke returns and after `close()`;
      a non-null error fails the node `cli_crash` (this is how an async
      write failure becomes fail-fast rather than an unhandled rejection).
    - `handleEvent`: wrap as
      `{ runtime, type: "session/update", raw: params }`, call
      `extractSessionContent` (`@korchasa/ai-ide-cli/runtime/content`),
      map items: `kind:"text"` → `[stream] text: <text>`;
      `kind:"tool"` → `[stream] tool: <name> <compact-args>` (and feed
      `Read` names to `FileReadTracker`, appending any warning line);
      `kind:"final"` → `[stream] result: <text>`. All lines go through
      `stampLines` and enqueue to the write chain. Empty extraction → no
      write. A throw inside `extractSessionContent` routes to the FR-E79
      `onCallbackError` WARN channel and skips the line (parse failure is
      best-effort; only the FS write is fatal).
    - **Turn markers are best-effort (critique #2).** The invoke path
      forwards no synthetic turn-end and chunks stream many-per-turn, so
      there is no sound per-turn boundary here. Emit `--- turn N ---`
      ONLY if a real discriminator surfaces in `params` (e.g.
      `sessionUpdate === "current_mode_update"`); otherwise OMIT turn
      markers entirely. No test asserts their presence.
    - `close`: writes a single `--- end ---` marker (timestamped) and
      closes the handle. Idempotent. Footer carries NO cost/duration —
      that lives in the run journal (FR-E17), not the stream log.
  - `class FileReadTracker` is instantiated once per `createStreamLogWriter`
    call, i.e. **per node run** — it spans the initial invoke and every
    continuation. This is a deliberate divergence from FR-E20's original
    "per invocation" wording (the old CLI writer was per-invoke); the
    develop phase updates the FR-E20 Description to state per-node-run
    scope. Rationale: repeated reads across `--resume` attempts are also
    worth surfacing.
- **MODIFY `src/engine/agent.ts`**:
  - In `runAgent`, when `streamLogPath` is set, construct
    `const streamLog = createStreamLogWriter(streamLogPath)` near the
    `onOutput`/`onCallbackError` construction (`:266-281`). Build
    `const onEvent = (params) => streamLog.handleEvent(params)`.
  - Add `onEvent` to BOTH invoke option objects
    (`initialInvokeOptions` `:311-339` and the resume invoke `:486-512`).
  - **Remove** `streamLogPath` from BOTH invoke option objects (it is
    dropped under ACP and triggers a spurious FR-E79 WARN). Keep the
    `streamLogPath` field on `AgentRunOptions` — it now seeds the writer.
    Before removing, grep `src/engine/agent_test.ts` (and `loop_test.ts`)
    for `streamLogPath` assertions and update/remove any that asserted
    library forwarding (critique #7).
  - After each `adapter.invoke()` returns, call `streamLog.takeWriteError()`;
    a non-null error short-circuits to
    `{ success: false, …, error_category: "cli_crash" }`.
  - Wrap the writer lifecycle in the existing `try`/`finally`: close it
    on every exit path (success, fail-fast returns, HITL early-return,
    continuation exhaustion, budget abort, hook failure) — mirror the
    `budgetTimer` cleanup. Re-check `takeWriteError()` after `close()`.
    Open-failure path returns
    `{ success: false, continuations: 0, error, error_category: "cli_crash" }`.
- **`src/engine/loop.ts`** — unchanged: it already passes
  `streamLogPath` into `runAgent`; ownership lives inside `runAgent`.
- **MODIFY `documents/requirements-engine/05-cli-and-observability.md`**
  — FR-E18: fix stale path; repoint FR-E18 + FR-E20 `**Tests:**` to
  `src/engine/stream-log_test.ts`, `src/engine/agent_test.ts`.
- **MODIFY `documents/index.md`** — add FR-E18 and FR-E20 rows.

### Data-First verification (pre-implementation, RED)

The exact ACP `session/update` `params` shape the invoke-path `onEvent`
delivers must be confirmed against `extractSessionContent`'s
`isAcpShapedEvent` expectations BEFORE finalizing the formatter — these
are two sides of the same wire and a shape mismatch silently yields zero
extracted content. Capture a real fixture from a live ACP run
(`deno run -A --no-check src/cli.ts run .flowai-workflow/github-inbox`,
then inspect a fresh `stream.log` / instrument `onEvent`), or lift a
`session/update` params fixture from the published library tests, and
encode it as the RED fixture in `stream-log_test.ts`. This fixture is a
HARD GATE — capture it from real bytes before writing any formatter
code; guessing the wire shape is the #1 integration-bug source
(AGENTS.md Data-First). Specific known hazard: the invoke-path `onEvent`
delivers a **top-level** `params.sessionUpdate` (`acp/adapter.ts:783`),
whereas `isAcpShapedEvent` may expect a nested `raw.update.sessionUpdate`
— confirm which, and if the public extractor cannot consume the wrapped
`params`, fall back to a thin engine-local discriminator on
`params.sessionUpdate` (`agent_message_chunk` → text,
`tool_call`/`tool_call_update` → tool).

### Error handling

- Writer open failure → `runAgent` returns `cli_crash` (verified:
  `cli_crash` ∈ `ErrorCategory`, `src/types.ts:356`).
- `handleEvent` write failure → reject; surfaced through the same
  `cli_crash` path. Never swallow.
- `extractSessionContent` throw on a malformed event must not crash the
  node — it routes through the existing `onCallbackError` WARN channel
  (FR-E79) and skips that line. (Persistence failure ≠ parse failure:
  the former is fatal, the latter is best-effort.)

### Verification commands

- `deno task check` (fmt + lint + full test suite + JSR slow-types).
- TDD: RED in `src/engine/stream-log_test.ts` and
  `src/engine/agent_test.ts` (mock adapter calls `opts.onEvent` with the
  ACP params fixture; assert file content has `[HH:MM:SS]` prefixes,
  text/tool lines, FR-E20 warning, append-across-continuations).
- Smoke (optional, after commit+push): `deno task run` checks out the
  worktree from `origin/<base>`, so local edits take effect only after
  push — DO NOT trust a smoke run against uncommitted changes. Once
  pushed, confirm a non-empty `runs/<run-id>/<node>/stream.log` with
  timestamped lines and that no FR-E79 "streamLogPath dropped" WARN
  appears. Unit + integration tests are the authoritative gate.

## Follow-ups

- If a second ACP runtime (Codex/OpenCode/Cursor) later needs identical
  stream-log formatting, promote the formatter to a shared library
  export (Variant B) to avoid per-runtime drift. Out of scope here
  (engine is Claude-primary, ACP-only).
