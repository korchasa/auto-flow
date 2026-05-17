---
date: "2026-05-17"
status: done
implements: [FR-E68, FR-E69]
tags: [engine, embedding, recovery, observability]
related_tasks:
  - 2026/05/node-lifecycle-callback.md
---
# engine: Durable run journal replay

## Goal

Persist canonical run lifecycle facts as a single append-only journal under
each run directory so embedded hosts can replay engine-owned execution history
after restart without scanning runtime-specific IDE storage, reading a
separate snapshot file, or reconstructing history from ad hoc files.

## Overview

### Context

Issue #218 reports that `flowai-center` embeds `flowai-workflow` in-process
and receives live node updates through `EngineOptions.onNodeLifecycle`.
That live callback is sufficient while the host process is alive, but recovery
after restart still requires mixing host registry data, host event logs,
`state.json`, run directories, and runtime-specific transcript storage.

The engine already owns the authoritative workflow execution data: run
status, node status, per-node logs, artifacts, session identifiers, loop
iteration metadata, cost, errors, and terminal state. It does not yet expose
one durable, ordered, append-only lifecycle stream that a host can replay to
rebuild the same logical snapshot it observed live.

### Current State

- FR-E68 defines live `NodeLifecycleEvent` callbacks for `running`,
  `completed`, `failed`, `waiting`, and `skipped` node transitions.
- `node-lifecycle.ts` mutates `RunState`, builds the live event, then awaits
  the optional host callback.
- `state.json` persists the latest run and node snapshot, including node
  status, session IDs, costs, result excerpts, errors, HITL question JSON, and
  loop iteration metadata.
- `state.json` is a latest-state snapshot, not an append-only event history;
  the target design replaces it as the recovery contract instead of adding a
  second snapshot file.
- Run-level transitions (`running`, `completed`, `failed`, `aborted`) are
  currently persisted only as snapshot fields on `RunState`.
- Agent logs are runtime-normalized JSON files plus optional Claude transcript
  copies; they are not a runtime-neutral lifecycle replay contract.
- HITL already uses an append-only `hitl.jsonl` audit file, but that scope is
  human input Q&A, not general run lifecycle recovery.

### Constraints

- Keep the engine domain-agnostic: no `flowai-center`, queue, server epoch,
  heartbeat, GitHub, or TUI facts in the durable contract.
- Keep host-control facts outside the engine: process ownership, orphan
  classification, operator controls, and server epoch remain host-owned.
- Durable replay and live callbacks must use the same node transition
  semantics, so hosts do not need two interpretation layers.
- The durable surface must be a single `journal.jsonl` file per run. Do not
  add `snapshot.json`, keep `state.json` as a recovery surface, or embed
  snapshot records inside the journal.
- The journal must start with normal bootstrap events from workflow execution,
  not an initial-state snapshot blob. Replayers start with an empty in-memory
  model and derive current state by applying events in order.
- The durable surface must tolerate process crashes, duplicate reads, and a
  partially-written final record.
- Terminal workflow facts must dominate stale host observations during replay.
- The contract must remain runtime-neutral across Claude, OpenCode, Cursor,
  and Codex.
- Current state must be computed by replaying `journal.jsonl`; any future cache
  is out of scope for this task.

## Definition of Done

- [x] FR-E69: Add the SRS index entry and SRS section for durable run
      lifecycle replay with an `**Acceptance:**` field covering replay,
      ordering, deduplication, terminal precedence, and runtime neutrality.
      Test: `documents/requirements-engine.md::FR-E69`;
      `documents/requirements-engine/05-cli-and-observability.md::FR-E69`.
      Evidence: `deno task check`.
- [x] FR-E69: Persist one append-only `journal.jsonl` lifecycle event stream
      under each run directory, with no `state.json`, `snapshot.json`, or
      embedded snapshot records as part of the recovery contract. Test:
      `lifecycle-replay_test.ts::persists ordered run and node lifecycle records`.
      Evidence: `deno test -A --no-check lifecycle-replay_test.ts`.
- [x] FR-E69: Durable records carry stable ordering and identity fields so
      hosts can deduplicate replayed records and ignore a malformed partial
      tail record. Test:
      `lifecycle-replay_test.ts::replay deduplicates records and ignores partial tail`.
      Evidence: `deno test -A --no-check lifecycle-replay_test.ts`.
- [x] FR-E68/FR-E69: Live `NodeLifecycleEvent` callbacks and durable replay
      records use the same node transition semantics and payload metadata.
      Test:
      `lifecycle-replay_test.ts::durable node records mirror live lifecycle semantics`.
      Evidence: `deno test -A --no-check lifecycle-replay_test.ts engine_test.ts`.
- [x] FR-E69: Replay starts from an empty in-memory model and reconstructs run
      status, discovered nodes, node status, attempt history, loop iteration
      status, session identifiers, costs, errors, and artifact paths after
      restart. Test:
      `lifecycle-replay_test.ts::replay reconstructs host recovery snapshot`.
      Evidence: `deno test -A --no-check lifecycle-replay_test.ts`.
- [x] FR-E69: Resume and recovery read current engine state from
      `journal.jsonl` replay instead of `state.json`. Test:
      `lifecycle-replay_test.ts::resume state is reconstructed from journal only`.
      Evidence: `deno test -A --no-check lifecycle-replay_test.ts engine_test.ts`.
- [x] FR-E69: All internal consumers that currently read or write
      `state.json` are migrated to journal replay or in-memory state access,
      including resume, dashboard/report helpers, worktree state copy, and
      public exports. Test:
      `lifecycle-replay_test.ts::state json is not required for run recovery`;
      `scripts/generate-dashboard_test.ts::dashboard reads replayed journal state`.
      Evidence:
      `deno test -A --no-check lifecycle-replay_test.ts scripts/generate-dashboard_test.ts`.
- [x] FR-E69: Terminal run records cannot be overwritten by stale non-terminal
      observations during replay. Test:
      `lifecycle-replay_test.ts::terminal workflow record wins over stale running snapshot`.
      Evidence: `deno test -A --no-check lifecycle-replay_test.ts`.
- [x] FR-E69: The durable lifecycle contract stays runtime-neutral and does
      not require scanning Claude, OpenCode, Cursor, or Codex home directories.
      Test:
      `lifecycle-replay_test.ts::replay uses only run directory lifecycle data`.
      Evidence: `deno test -A --no-check lifecycle-replay_test.ts`.
- [x] FR-E68/FR-E69: Public exports and design notes document the durable
      replay API, record schema, ordering rules, error policy, and relationship
      to `EngineOptions.onNodeLifecycle`. Test:
      `mod.ts::lifecycle replay exports`;
      `documents/design-engine/04-data-and-logic.md::Durable Lifecycle Replay`.
      Evidence: `deno task check`.
- [x] FR-E69: Full verification passes. Test: `deno task check`. Evidence:
      `deno task check`.

## Solution

### Selected Variant

Use a single per-run `journal.jsonl` as the durable recovery surface. Do not
add `snapshot.json`, do not preserve `state.json` as a required recovery file,
and do not write snapshot records into the journal. The journal is the only
persisted lifecycle state for a run. Current state is reconstructed by replaying
events from the beginning.

The journal does not contain an initial-state blob. It begins with regular
bootstrap events emitted by workflow execution, such as run start, workflow
metadata discovery, node discovery, node path declaration, and then normal
node/run transition events. A replayer starts from an empty in-memory model and
applies those events in `seq` order.

### Files to Create or Modify

- New `run-journal.ts`
  - Define `RunJournalEvent` as a versioned discriminated union.
  - Define `RunJournalWriter` that appends one JSON line per event.
  - Define `RunJournalReplayer` that reads `journal.jsonl`, ignores malformed
    partial tail lines, deduplicates stable event IDs, and derives a
    `RunState`-compatible in-memory snapshot.
  - Keep all filesystem paths run-directory-relative for host portability.
- `types.ts`
  - Add public journal event and replay result types.
  - Keep `NodeLifecycleEvent` semantics aligned with node journal events.
- `state.ts`
  - Stop treating `state.json` as persisted recovery state.
  - Keep pure in-memory state mutation helpers if they still simplify engine
    logic.
  - Replace persisted load/save APIs with journal replay/write APIs, or remove
    old APIs when no caller remains.
- `node-lifecycle.ts`
  - Emit the same node transition semantics to both the optional live callback
    and the journal writer.
  - Record node transition events after in-memory mutation, with the same
    metadata as `NodeLifecycleEvent`.
- `engine.ts`
  - Create the run journal writer when a run directory is created.
  - Emit bootstrap events at the beginning of a fresh run:
    `run_started`, workflow config reference, node discovery, and node output
    directory declarations.
  - Write all bootstrap events before the first executable node transition;
    if any bootstrap journal append fails, abort before executing nodes.
  - On resume, replay `journal.jsonl` to rebuild in-memory state before
    selecting resumable nodes.
  - Emit terminal run events (`run_completed`, `run_failed`, `run_aborted`) as
    the final authoritative facts.
- `loop.ts`
  - Emit loop iteration events before and after each iteration.
  - Ensure body-node events include `iteration` so repeated body-node IDs do
    not collapse into one logical attempt.
- `agent.ts` and `node-dispatch.ts`
  - Emit attempt and continuation events around runtime invocations.
  - Record session IDs, continuation counts, cost, result excerpt, validation
    outcome, and artifact directory paths through journal events.
- `hitl.ts` and `hitl-handler.ts`
  - Keep detailed question/answer audit in `hitl.jsonl`.
  - Record lifecycle-level `waiting` and resumed/failed facts in
    `journal.jsonl`.
- `mod.ts`
  - Export the replay API and journal event types as the documented host
    recovery surface.
- `scripts/generate-dashboard.ts` and other state readers
  - Replace direct `state.json` reads with `journal.jsonl` replay.
  - Preserve the same rendered information where possible, but treat missing
    historical facts as explicit absent data rather than inventing defaults.
- Tests
  - Add `lifecycle-replay_test.ts` for journal write, replay, ordering,
    deduplication, partial-tail tolerance, terminal precedence, and host
    recovery snapshot reconstruction.
  - Update `engine_test.ts`, `loop_test.ts`, `hitl_test.ts`, and
    `state_test.ts` where existing assertions assume `state.json`
    persistence.
- Documentation
  - Add FR-E69 to the engine SRS index and CLI/observability SRS section.
  - Update the engine SDS data and logic section to define
    `journal.jsonl`, replay rules, event schema, and the removal of
    `state.json` as a recovery contract.

### Event Model

- Every event has:
  - `schema_version`
  - `run_id`
  - `seq`
  - `event_id`
  - `kind`
  - `ts`
- `event_id` is stable and deduplicatable. Use a deterministic composition
  such as `run_id + seq + kind + node_id + iteration + attempt`, not a random
  identifier.
- Run bootstrap events establish the replayer's model:
  - `run_started`
  - `workflow_loaded`
  - `node_declared`
  - `node_directory_declared`
- Bootstrap events are not an initial-state snapshot. They are ordinary facts
  emitted in execution order, and they must be complete before later node
  transition events can be replayed successfully.
- Node transition events mirror FR-E68 semantics:
  - `node_started`
  - `node_completed`
  - `node_failed`
  - `node_waiting`
  - `node_skipped`
- Runtime attempt events preserve history that a latest-state snapshot cannot:
  - `attempt_started`
  - `attempt_completed`
  - `continuation_started`
  - `continuation_exhausted`
- Loop events preserve repeated execution:
  - `loop_iteration_started`
  - `loop_iteration_completed`
  - `loop_iteration_failed`
- Terminal run events dominate stale observations:
  - `run_completed`
  - `run_failed`
  - `run_aborted`

### Data Lifecycle

- Run identity
  - Source: engine at fresh run start or CLI resume argument.
  - Journal: all events include `run_id`.
  - Replay: groups and validates events for one run.
  - Risk: mixed-run event files; fail clearly if a line has another `run_id`.
- Run status
  - Source: engine transition points.
  - Journal: `run_started` and terminal run events.
  - Replay: latest terminal event wins over any stale non-terminal state.
  - Risk: crash before terminal event; replay reports the last durable fact,
    which may be non-terminal.
- Workflow and node declarations
  - Source: loaded workflow config at run start.
  - Journal: `workflow_loaded`, `node_declared`.
  - Replay: builds the node map without reading the current workflow config.
  - Risk: config changed after run; replay uses historical declarations from
    the journal.
- Node status
  - Source: engine node lifecycle transitions.
  - Journal: node transition events.
  - Replay: derives current node status from ordered events.
  - Risk: duplicated events; `event_id` deduplication makes replay idempotent.
- Attempt and continuation history
  - Source: agent runtime invocation loop.
  - Journal: attempt/continuation events.
  - Replay: reconstructs history per node, iteration, and attempt number.
  - Risk: continuation count drift; event order is authoritative.
- Loop iteration
  - Source: loop executor.
  - Journal: loop iteration events and `iteration` on body-node events.
  - Replay: keeps repeated body-node executions distinct.
  - Risk: body node ID reuse across iterations; `iteration` is part of the
    logical key.
- Session identifiers
  - Source: normalized runtime output.
  - Journal: attempt completion and node waiting/completion events.
  - Replay: restores session IDs without scanning IDE home directories.
  - Risk: runtime omits session ID; event records absence explicitly.
- Artifacts
  - Source: engine path computation and validation results.
  - Journal: node directory declaration and artifact validation events.
  - Replay: exposes artifact paths relative to the run directory.
  - Risk: file deleted after event; replay reports the recorded fact, readers
    may separately check file existence.
- Cost and result
  - Source: normalized runtime output.
  - Journal: attempt completion and node completion events.
  - Replay: rebuilds per-node and aggregate cost from durable facts.
  - Risk: runtimes without cost data; replay preserves missing data rather
    than inventing defaults.
- Errors
  - Source: engine, validation, runtime adapter, HITL handler, budget checks.
  - Journal: failed attempt, failed node, and failed run events.
  - Replay: restores error text and category for host display.
  - Risk: host-owned errors are out of scope and must not be written into the
    engine journal.

### Error Handling Strategy

Journal append failure is an engine failure. The recovery contract is durable
only if lifecycle facts are written before execution proceeds past the fact
being recorded. Do not silently fall back to in-memory-only progress, do not
write a secondary snapshot file, and do not let host callback success hide a
journal write failure.

This is a breaking storage-contract change: consumers must stop depending on
`state.json` as a persisted file. Compatibility shims, duplicate snapshot
files, and temporary dual writes are out of scope by decision.

A malformed final line is treated as a partial tail and ignored during replay.
Malformed non-tail lines fail replay clearly because they indicate journal
corruption rather than a normal crash boundary.

Replay must be deterministic: applying the same journal twice yields the same
state, duplicate `event_id`s are ignored, and terminal run events dominate
non-terminal observations.

Replay performance is intentionally accepted as linear in journal size for
this task. Snapshot files, embedded snapshot events, checkpoint directories,
and compaction are not part of the design unless a future task demonstrates a
measured need.

### Verification Commands

- `deno test -A --no-check lifecycle-replay_test.ts`
- `deno test -A --no-check engine_test.ts loop_test.ts hitl_test.ts state_test.ts`
- `deno task check`
