---
date: "2026-06-04"
status: done
implements: [FR-E79]
tags: [observability, acp, transport, diagnosis]
related_tasks:
  - 2026/06/acp-codex-transport-issues-report.md
  - 2026/06/acp-transport-config.md
---
# Engine surfaces runtime `onCallbackError` as visible WARN lines

## Goal

Stop swallowing `@korchasa/ai-ide-cli`'s `onCallbackError` channel inside
`runAgent`. The library uses it for two cross-cutting diagnostics:
(a) consumer-callback throws (`onEvent`, `onStderr`, `onToolUseObserved`,
`onSendFailed` — FR-L32), and (b) ACP transport degradations
(`degradedOptions` — FR-L39, e.g. `systemPrompt` inlined into
`prompt[0].text`, `streamLogPath` dropped, `resumeSessionId` ignored).
The engine passes neither callback today, so the library falls back to
`console.warn` with a generic prefix that operators do not associate
with a specific node, and the run journal contains no record.
P3 of the LumaTale ACP incident report
(`documents/tasks/2026/06/acp-codex-transport-issues-report.md`) calls
this out as the "silent inlining" diagnostic gap that fed the opaque
`-32700` failure.

## Overview

### Context

- Library API: `RuntimeInvokeOptions.onCallbackError?: (err, source) => void`
  (`@korchasa/ai-ide-cli/runtime/adapter-types.ts:251`, signature in
  `runtime/callback-safety.ts:48`).
- ACP adapter routes degraded options via this channel:
  `runtime/acp/adapter.ts:78-96` (`reportDegradedOptions` — synthesizes
  one `Error` per degraded field, source `"onEvent"`).
- CLI adapters (claude / opencode / codex / cursor) use the same channel
  for consumer-callback throws.
- Engine current behaviour: `agent.ts` builds `RuntimeInvokeOptions` at
  two call sites (`agent.ts:269` initial, `agent.ts:411` continuation/
  resume) and passes neither `onCallbackError` nor the engine's
  `OutputManager`. The library's default handler logs to `console.warn`
  with `[ai-ide-cli]` prefix — no node-id tag, not routed through
  `OutputManager`, invisible to `-q`/`-v` semantics, no journal entry.
- `OutputManager.warn(message: string)` already exists
  (`output.ts:107-110`): writes `WARN: <message>\n` to stderr, suppressed
  under `quiet`. We will tag node-id ourselves to keep the public method
  signature unchanged.

### Current State

- `runAgent` accepts `output?: OutputManager` and `nodeId?: string`
  (`agent.ts:123-126`) but uses them only for verbose lifecycle/prompt/
  validation output, not for runtime-side warnings.
- Both `adapter.invoke()` call sites mirror an identical option block
  (`agent.ts:269-292` initial, `:411-435` resume). Any new field has to
  be added in two places — accepted duplication per the existing
  pattern.

### Constraints

- Do NOT add a new public engine API (no new `EngineOptions` field, no
  new CLI flag). The diagnostic is engine-internal plumbing of an
  existing library callback.
- Do NOT break the no-`output` test path: many `runAgent` call sites in
  tests omit `OutputManager`. Synthesize the callback only when
  `output && nodeId` are both present; otherwise omit the field so the
  library falls back to its default `console.warn` (current behaviour
  preserved for headless embedders).
- Do NOT throw from inside the callback. `OnCallbackError` is itself
  wrapped in try/catch inside the library, but defensive code avoids
  re-entry.
- Do NOT couple to ACP. The same wiring serves CLI runtimes' FR-L32
  consumer-throw diagnostics — agnostic to transport.
- Output format must be greppable and node-tagged so multi-node runs
  remain debuggable. Prefix with the same node-id padding convention
  used by other `OutputManager` lines (`<nodeId>.padEnd(16)`).
- Keep the message under one line — multi-line `err.stack` would
  drown the stream-log. Use `err.message` for `Error` instances,
  `String(err)` otherwise.

## Definition of Done

- [x] FR-E79 added to `documents/requirements-engine.md` index and
      `documents/requirements-engine/05-cli-and-observability.md` section,
      with `**Tests:**` regression-lock pointing at `agent_test.ts`.
      Evidence: `documents/requirements-engine.md:117`,
      `documents/requirements-engine/05-cli-and-observability.md:404`.
- [x] `agent.ts` builds an `onCallbackError` callback in `runAgent` (one
      helper, reused between initial and resume invocations) that calls
      `output.warn(...)` with `<nodeId> runtime <source>: <message>` when
      both `output` and `nodeId` are present. Evidence:
      `agent.ts::runAgent` (`onCallbackError` helper + both call sites).
- [x] `agent_test.ts` adds `FR-E79`-named regression tests that drive
      `opts.onCallbackError` from a fake adapter and assert the WARN
      buffer contains `<nodeId> runtime onEvent: <reason>`, plus an
      opt-out test verifying `onCallbackError: undefined` is forwarded
      when `OutputManager` is omitted. Evidence: `agent_test.ts`
      (`FR-E79 runtime onCallbackError surfaces as engine warn`,
      `FR-E79 omitted OutputManager keeps onCallbackError undefined`).
- [x] `deno task check` exits 0 (regression-locked by full test suite).
- [x] No new dependency, no new CLI flag, no change to `RuntimeInvokeOptions`
      forwarding for runtimes that don't surface degraded options
      (Claude CLI, OpenCode CLI). Behaviour identical when `output` is
      omitted (covered by existing tests that pass no OutputManager).
      Evidence: `agent.ts::runAgent` (`onCallbackError = output && nodeId
      ? ... : undefined`).

## Solution

1. **FR-E79 in SRS.**
   - Insert FR-E79 mapping in `documents/requirements-engine.md` (alphabetical
     suffix after FR-E78, → `05-cli-and-observability`).
   - Insert FR-E79 section in
     `documents/requirements-engine/05-cli-and-observability.md` after
     FR-E69 (last in file). Canonical field order:
     `Description`, `Motivation`, `Acceptance criteria` (`**Tests:**`
     line pointing at `agent_test.ts`).
   - Description: engine routes library `onCallbackError(err, source)`
     to `OutputManager.warn` with a `<nodeId> runtime <source>: <msg>`
     prefix. Covers FR-L32 consumer-callback throws and FR-L39 ACP
     degraded-option diagnostics. Suppressed only under `--quiet` (per
     existing `OutputManager.warn` semantics).
   - Motivation: cites the P3 surface in the LumaTale ACP report
     (`documents/tasks/2026/06/acp-codex-transport-issues-report.md`).

2. **Engine implementation.**
   - In `agent.ts::runAgent`, build a single `onCallbackError` callback
     once after destructuring:
     ```ts
     const warnFromRuntime = output && nodeId
       ? (err: unknown, source: string) => {
           const msg = err instanceof Error ? err.message : String(err);
           output.warn(`${nodeId.padEnd(16)}runtime ${source}: ${msg}`);
         }
       : undefined;
     ```
     Reuse `warnFromRuntime` in `initialInvokeOptions` and the resume
     `adapter.invoke({...})` call-site by adding
     `onCallbackError: warnFromRuntime` to both option objects.
   - Import `OnCallbackError` from `@korchasa/ai-ide-cli/runtime/callback-safety`
     IF inline type annotations require it. Prefer leaving the helper's
     parameter types inline (`unknown`, `string`) so no new import is
     needed.

3. **RED test.**
   - In `agent_test.ts`, add a test `FR-E79 runtime onCallbackError
     surfaces as engine warn`. Use a fake adapter (clone the existing
     stub pattern in the file) whose `invoke` invokes
     `opts.onCallbackError?.(new Error("option \"systemPrompt\" degraded — inlined"), "onEvent")`
     before returning a minimal successful `RuntimeInvokeResult`.
   - Drive `runAgent` with a capturing `OutputManager` (existing tests
     already use a `lines: string[]` collector — reuse). Assert the
     captured stderr contains `runtime onEvent: option "systemPrompt"
     degraded — inlined` and the node-id prefix.

4. **GREEN.** Apply the engine wiring from step 2. Re-run the new test
   → passes.

5. **REFACTOR.** No-op unless `warnFromRuntime` needs to be moved
   nearer the option object. Reuse without renaming.

6. **CHECK.** `deno task check`. Must exit 0. No new lint/type errors,
   no `deno publish --dry-run` regression (helper is private to
   `runAgent`, no new exported surface).
