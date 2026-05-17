---
date: "2026-05-17"
status: done
implements: [FR-E68]
tags: [engine, embedding, observability]
related_tasks:
  - 2026/05/phase-registry-per-run.md
  - 2026/05/hitl-via-engine-mcp.md
  - 2026/05/engine-decomposition.md
---
# engine: Expose node lifecycle callback for embedded hosts

## Goal

Expose node lifecycle transitions from `Engine.run()` to embedded hosts so
library consumers can render live workflow progress without polling
`state.json`, parsing terminal logs, or duplicating DAG execution behavior.

## Overview

### Context

Issue #217 reports that `flowai-center` embeds `Engine` in the same Deno
process and needs live node state for its TUI and Assistant context. The
engine already persists node state transitions in `RunState`, but the public
`EngineOptions` surface has no observer hook for intermediate node updates.

### Current State

- `EngineOptions` exposes run configuration, verbosity, budget, lock, and
  `processRegistry`, but no node lifecycle callback.
- `state.ts` mutates node state through `markNodeStarted`,
  `markNodeCompleted`, `markNodeFailed`, `markNodeWaiting`, and
  `markNodeSkipped`.
- Top-level nodes transition mostly through `engine.ts::executeNode`;
  loop body nodes transition inside `loop.ts::runLoop`.
- HITL waiting state is set in `hitl-handler.ts::handleAgentHitl`.
- Post-workflow skipped nodes are set in `post-workflow.ts`.
- Embedded hosts can inspect only final `RunState` after `await engine.run()`
  resolves.

### Constraints

- Keep the engine domain-agnostic: no `flowai-center`, TUI, GitHub, PR, or
  transport-specific schema in the upstream callback.
- The callback must be optional and additive; omitted callback preserves CLI
  and current library behavior.
- Event payload must use engine-native concepts: run ID, node ID, status,
  timestamp, and optional node metadata already represented in `NodeState`.
- Callback ordering must match persisted state transitions: the callback must
  observe the same status and metadata that was written into `RunState`.
- Callback rejection policy must be explicit, documented, and tested.
- Coverage must include top-level nodes, loop body nodes, skipped nodes,
  failed nodes, and HITL waiting nodes.

## Definition of Done

- [x] FR-E68: Add the SRS index entry and section for `FR-E68` with an
      `**Acceptance:**` field describing the node lifecycle callback
      contract. Test:
      `documents/requirements-engine.md::FR-E68`;
      `documents/requirements-engine/05-cli-and-observability.md::FR-E68`.
      Evidence: `deno task check`.
- [x] FR-E68: `EngineOptions` exposes an optional node lifecycle callback
      suitable for embedded hosts. Test:
      `engine_test.ts::EngineOptions exposes node lifecycle callback`.
      Evidence: `deno test -A --no-check engine_test.ts`.
- [x] FR-E68: Callback payload includes run ID, node ID, status, timestamp,
      and stable optional metadata such as error, error category, duration,
      cost, result excerpt, session ID, question JSON, and loop iteration when
      available. Test:
      `engine_test.ts::node lifecycle callback payload mirrors node state`.
      Evidence: `deno test -A --no-check engine_test.ts`.
- [x] FR-E68: Callback fires after `RunState` mutation for `running`,
      `completed`, `failed`, `waiting`, and `skipped`, so observer order
      matches persisted state transitions. Test:
      `engine_test.ts::node lifecycle callback order follows state updates`.
      Evidence: `deno test -A --no-check engine_test.ts`.
- [x] FR-E68: Omitted callback preserves current behavior for CLI and library
      callers. Test:
      `engine_test.ts::node lifecycle callback omitted preserves no-hook behavior`.
      Evidence: `deno test -A --no-check engine_test.ts`.
- [x] FR-E68: Callback coverage includes top-level agent, merge, loop, and
      human nodes, loop body nodes, post-workflow skipped nodes, failed nodes,
      and HITL waiting nodes. Test:
      `engine_test.ts::node lifecycle callback covers top-level and special states`;
      `loop_test.ts::loop body lifecycle callback covers iteration metadata`;
      `hitl_test.ts::HITL waiting emits node lifecycle callback`. Evidence:
      `deno test -A --no-check engine_test.ts loop_test.ts hitl_test.ts`.
- [x] FR-E68: Callback rejection behavior is explicit: a rejected callback
      fails fast with a clear error and does not silently disappear. Test:
      `engine_test.ts::node lifecycle callback rejection fails run clearly`.
      Evidence: `deno test -A --no-check engine_test.ts`.
- [x] FR-E68: Public documentation and design notes describe the callback
      shape, ordering, metadata, and failure policy. Test:
      `documents/design-engine/04-data-and-logic.md::Node Lifecycle Callback`.
      Evidence: `deno task check`.
- [x] FR-E68: Full verification passes. Test:
      `deno task check`. Evidence: `deno task check`.

## Solution

### Selected Variant

Use a single asynchronous node-lifecycle transition layer above `state.ts`.
Keep the existing `markNodeStarted`, `markNodeCompleted`,
`markNodeFailed`, `markNodeWaiting`, and `markNodeSkipped` functions as
low-level synchronous state mutators for compatibility and focused unit tests.
Move engine execution paths to new async transition helpers that mutate
`RunState`, then immediately emit the optional callback from the updated node
state.

### Files to Modify

- `types.ts`
  - Add `NodeLifecycleEvent` with:
    - `run_id: string`
    - `node_id: string`
    - `status: NodeStatus`
    - `timestamp: string`
    - `node: NodeState`
    - flattened optional metadata copied from `NodeState`:
      `error`, `error_category`, `duration_ms`, `cost_usd`, `result`,
      `session_id`, `question_json`, `iteration`
  - Add `NodeLifecycleCallback = (event: NodeLifecycleEvent) =>
    void | Promise<void>`.
  - Add `EngineOptions.onNodeLifecycle?: NodeLifecycleCallback`.
    Use camelCase to match the existing embedding-oriented
    `processRegistry` option; do not expose it through YAML or CLI flags.
    This is library-mode API only.
- New `node-lifecycle.ts`
  - Export transition helpers:
    - `nodeStarted(state, nodeId, callback?)`
    - `nodeCompleted(state, nodeId, costUsd?, result?, callback?)`
    - `nodeFailed(state, nodeId, error, errorCategory?, callback?)`
    - `nodeWaiting(state, nodeId, sessionId, questionJson, callback?)`
    - `nodeSkipped(state, nodeId, callback?)`
  - Each helper calls the matching `markNode*` mutator first, then builds a
    `NodeLifecycleEvent` from `state.nodes[nodeId]`.
  - Event timestamp rule:
    - `running` uses `started_at` when present.
    - `completed` and `failed` use `completed_at` when present.
    - `waiting` and `skipped` use a fresh ISO timestamp because the current
      `NodeState` schema does not persist a dedicated timestamp for those
      statuses.
  - `emitNodeLifecycle()` awaits the callback when provided and is a no-op
    when omitted.
  - Wrap callback failures in a clear error:
    `Node lifecycle callback failed for node '<id>' status '<status>': <message>`.
- `engine.ts`
  - Construct a small lifecycle controller closure from
    `this.state` and `this.options.onNodeLifecycle`.
  - Replace top-level `markNodeStarted`, `markNodeCompleted`,
    `markNodeFailed`, and `markNodeSkipped` execution-path calls with async
    transition helpers.
  - Convert skip/only filtering in `executeLevel()` from synchronous
    `Array.filter()` to an explicit loop so skipped transitions can be
    awaited.
  - Keep `saveState()` after successful transition emission, preserving the
    existing state-write cadence while guaranteeing the callback observes the
    already-mutated `RunState`.
  - On callback rejection, let the clear wrapped error propagate through the
    same failure path as other engine execution errors; do not swallow or
    retry callback failures.
- `node-dispatch.ts`
  - Add lifecycle transition functions to `EngineContext`.
  - Replace internal failure mutations in `executeAgentNode()` and
    `executeLoopNode()` with the lifecycle helpers.
  - Pass the lifecycle helper into HITL handling.
- `loop.ts`
  - Add lifecycle transition functions to `LoopRunOptions`.
  - Replace loop-body calls to `markNodeStarted`, `markNodeCompleted`, and
    `markNodeFailed` with awaited lifecycle helpers.
  - Preserve loop iteration metadata by setting
    `state.nodes[bodyNodeId].iteration` before emitting the loop body's
    `running` event, then keep the same value available on completion and
    failure events.
- `hitl-handler.ts`
  - Replace `markNodeWaiting` and HITL failure mutations with lifecycle
    helpers so `waiting` and failed resume/detect paths emit callbacks.
- `post-workflow.ts`
  - Accept an optional async `nodeSkipped` transition helper and use it for
    `run_on`-filtered post-workflow skips.
- `mod.ts`
  - Export `NodeLifecycleEvent` and `NodeLifecycleCallback` as part of the
    documented public embedding surface. Do not export the transition helper
    module; it remains internal engine plumbing.
- Documentation
  - Add `FR-E68` to `documents/requirements-engine.md` index and to
    `documents/requirements-engine/05-cli-and-observability.md`.
  - Add the data and logic contract to
    `documents/design-engine/04-data-and-logic.md`.

### Implementation Approach

1. RED: add focused tests for the public type shape and callback semantics.
   Start with no-hook compatibility, payload shape, ordering after mutation,
   and callback rejection. These tests should fail before implementation.
2. GREEN: add `NodeLifecycleEvent`, `NodeLifecycleCallback`, and
   `EngineOptions.onNodeLifecycle`.
3. GREEN: add `node-lifecycle.ts` and unit-test the pure event builder and
   callback failure wrapping.
4. GREEN: migrate top-level `engine.ts` transitions first:
   - `running`
   - `completed`
   - `failed`
   - skip/only `skipped`
5. GREEN: migrate special execution paths:
   - post-workflow `skipped`
   - loop body `running`, `completed`, `failed`
   - HITL `waiting` and HITL failure paths
6. REFACTOR: remove duplicated event payload assembly and keep event shaping
   in one helper.
7. CHECK: run targeted tests, then full project check.

### Error Handling Strategy

The callback is part of the embedding host contract. If it rejects, the engine
must fail fast with a clear error instead of silently losing progress events.
The transition helper mutates `RunState` first, then awaits the callback. A
callback failure throws a wrapped error naming node ID and status. Existing
engine error handling then marks the run or node failed according to the
current execution path and persists state through the normal save path.

Callback failure handling must not recursively emit another lifecycle event
for the callback's own failure. If the callback fails while reporting a
`failed` event, preserve the wrapped callback error as the surfaced error
instead of trying to publish a second `failed` event.

Do not add fallback logging, best-effort retry, or background fire-and-forget
delivery. Those policies belong in the embedding host's callback.

Do not add YAML fields, CLI flags, or workflow config support for the callback.
The hook is an in-process library embedding API only.

### Follow-ups

- Audit whether loop body `runAgent()` should thread
  `EngineOptions.processRegistry` under FR-E60. That is embedding-related but
  out of scope for FR-E68 unless a lifecycle test exposes it directly.

### Verification Commands

- `deno test -A --no-check engine_test.ts`
- `deno test -A --no-check loop_test.ts`
- `deno test -A --no-check hitl_test.ts`
- `deno task check`
