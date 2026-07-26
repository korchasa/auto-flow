---
date: "2026-07-26"
status: done
implements:
  - FR-E86
tags: [engine, testing, runtime, adapter]
related_tasks:
  - 2026/06/acp-codex-transport-issues-report.md
---

# Test runtime adapter driven by a TS handler

## Goal

Exercise the engine's own logic — validation, continuation, resume, scope
guardrail, HITL routing, state, journal, loops — end-to-end without spending an
agent turn, so engine-side regressions are caught by CI instead of by a live
SDLC run.

## Overview

### Context

Failure classes observed in [acp-codex-transport-issues-report](../06/acp-codex-transport-issues-report.md)
split in two:

- Engine-owned and fixable here: `stream.log` ownership (P2), silent
  degraded-options (P3), runaway retries bounded by FR-E80 (P4).
- Front/upstream-owned: `-32700` from `codex-acp` (P1), silently dropped
  `resumeSessionId` (P5).

The first group lives entirely above `adapter.invoke()`. Emulating the ACP
front instead was rejected: a fake front encodes OUR beliefs about the
protocol, and P1/P5 are exactly where those beliefs were wrong — a green test
built on a wrong belief is worse than no test.

### Current State (before this task)

- `runtimeAdapter` injection existed only on `runAgent` (`agent.ts:128`) and
  `handleAgentHitl` (`hitl-handler.ts:51`).
- `node-dispatch.ts:165` and `loop.ts:300` called `runAgent` without it, and
  `EngineOptions` had no such field — no full-run test was possible.
- ~33 hand-rolled adapter stubs across 5 test files, each repeating the
  9-field capability vector.
- `loop_test.ts` stated outright: "Full integration tests for runLoop require
  claude CLI" — `runLoop` had never been executed by a test.
- CI installs host CLIs for plugin-install acceptance only; no test ever ran
  an agent turn.

### Constraints

- No new `workflow.yaml` surface: a real run must not be able to select a fake
  runtime.
- Omitting the seam preserves production behaviour byte-for-byte.
- Test module stays out of the JSR tarball.
- Branching belongs in the test's handler, not in the fake's own code.

## Definition of Done

- [x] `EngineOptions.runtimeAdapter` reaches top-level agent nodes, loop-body
      nodes, and HITL resume turns. Evidence: `src/types.ts:770`,
      `src/engine/node-dispatch.ts:134,178,269,364,415` (5 sites),
      `src/engine/loop.ts:316`.
- [x] `createFakeRuntime(handler)` drives replies, artifacts, abort-aware
      sleeps, output-less failure, and adapter crashes; records `calls`.
      Evidence: `src/testing/fake-runtime.ts`.
- [x] Capabilities default to the real adapter's ACP vector.
      Evidence: `src/testing/fake-runtime.ts` `capabilitiesFor`.
- [x] `Engine.run()` completes an agent node with a continuation, and fails
      cleanly on runtime death, with no agent. Evidence: `src/engine/engine_test.ts`
      (FR-E86).
- [x] `runLoop` runs for real for the first time — two iterations, exit on
      condition value. Evidence: `src/engine/loop_test.ts` (FR-E86).
- [x] `src/testing` excluded from the JSR tarball. Evidence: `deno.json#publish.exclude`.
- [x] SRS + SDS + `AGENTS.md` updated.

## Solution

1. `src/testing/fake-runtime.ts` — `createFakeRuntime(handler, {id, capabilities})`
   returning a `FakeRuntimeAdapter` (`RuntimeAdapter` + `calls`). Handler
   receives `{opts, index, history, reply, fail, write, sleep}`.
2. Thread `EngineOptions.runtimeAdapter` through `node-dispatch.ts` (runAgent,
   both `handleAgentHitl` sites, `runLoop`) and `LoopRunOptions` → `loop.ts`.
3. Tests: `fake-runtime_test.ts` (helper semantics), `engine_test.ts` (full run,
   continuation, runtime failure), `loop_test.ts` (real `runLoop`).
4. Docs: FR-E86 in `requirements-engine/01-execution-model.md`, index line,
   SDS `design-engine/03-subsystems.md` §3.8, `AGENTS.md` repo layout.

### Findings surfaced by the first real `runLoop` test

`markNodeCompleted` OVERWRITES `NodeState.cost_usd`, and `updateRunCost` sums
node costs — so a loop body node contributes only its LAST iteration to
`RunState.total_cost_usd`. Two iterations at $0.02 each report $0.02, not
$0.04. `loop.ts` keeps a correct local `totalLoopCost` for the FR-E47 preempt
heuristic, so the under-report is confined to run-level totals and the
workflow-wide `--budget` cap that reads them. Locked as current behaviour in
`loop_test.ts` with a comment; NOT fixed here — changing it alters FR-E17
cost reporting and FR-E47 budget semantics, which is a separate decision.

### Injection-site coverage measured by mutation (review pass)

Deleting each injection site one at a time and running the whole suite kills
only 2 of 6:

- killed — `node-dispatch.ts:178` (top-level agent node), 2 failing tests.
- killed — `loop.ts:316` (loop-body agent), 1 failing test.
- survived — `node-dispatch.ts:134` (HITL resume), `:269` (top-level HITL
  detect), `:364` (`runLoop` from `executeLoopNode`), `:415` (loop-body HITL
  detect).

`:364` is the practically important gap: `loop_test.ts` calls `runLoop`
directly, so no test drives a loop through `Engine.run()`. A broken site fails
loudly (engine falls back to the real adapter and tries to spawn an agent), so
the cost is a confusing failure, not a silent pass. Not closed here — the
follow-up is one `Engine.run()` test over a loop workflow. SRS/SDS record the
partial lock so the `**Tests:**` line is not read as full coverage.
