---
date: "2026-07-26"
status: done
implements:
  - FR-E25
  - FR-E50
  - FR-E54
  - FR-E69
  - FR-E73
---
# Comprehensive review fixes: secret leakage, path traversal, fail-fast gaps

## Goal

Close the defects found by a full-project review: two security holes, seven
correctness bugs, two config-strictness gaps, and the documentation that had
drifted away from the code.

## Overview

### Context

`deno task check` was green and 1050 tests passed, so nothing here was caught
by CI. The findings came from reading the engine, isolation, HITL, MCP and CLI
layers against `README.md`, `AGENTS.md` and the SRS/SDS.

### Current State (before)

- `.env` values landed verbatim in `journal.jsonl` and were returned to the
  calling model by MCP `get_state`. A live Telegram bot token was found in
  `.flowai-workflow/github-inbox/runs/20260524T015927/journal.jsonl`.
- `run_id` / `node_id` / `filename` reached path helpers unchecked, so
  `tail_artifacts` read any file on disk.
- `runLoop` ignored `hitl_question`: a body node's HITL request was never
  routed and the run failed later on a missing condition field.
- A partial `defaults.hitl` block erased `poll_interval`/`timeout`, producing
  `NaN` deadlines and an instant "HITL timeout after undefineds".
- `runLoop` did not forward `processRegistry` (FR-E60 broken for loop bodies).
- `max_parallel` defaulted to `0` (unlimited) while docs claimed sequential
  execution; the FR-E50 guardrail cannot attribute leaks across concurrent
  nodes sharing one worktree.
- `acquireLock` was read-then-write (TOCTOU); `EPERM` from `Deno.kill` was
  read as "process dead".
- Merge nodes swallowed every copy error; an over-budget resume left the
  journal at `run_started`; `createWorktree` fetched `origin main` whatever
  `ref` said; validation rules interpolated without the worktree cwd.
- Any unknown `--flag` became a workflow argument and ate the next token;
  unknown node keys were ignored.

## Definition of Done

- [x] Secrets never persisted or exposed through MCP.
- [x] Externally supplied identifiers cannot escape `runs/`.
- [x] HITL works inside loop bodies; misconfiguration fails loudly.
- [x] Lock acquisition is atomic and liveness detection is correct.
- [x] Docs (README, AGENTS.md, SRS, SDS) match the code.
- [x] Every fixed defect that can regress silently carries a test that fails
      when the fix is reverted.
- [x] `deno task check` green.

## Solution

### Decisions

- **Journal stores `env_keys`, not `env`.** Redacting values in place would
  break resume; a heuristic "looks like a secret" filter would silently miss
  keys. Storing names only is deterministic, keeps post-mortems useful, and
  makes resume re-read the live environment — a key that vanished now fails
  fast at `{{env.X}}` instead of resolving to stale text.
- **Validation lives at the MCP boundary**, not inside the path helpers. The
  helpers stay pure string builders; `assertSafeSegment` /
  `assertSafeRelativePath` guard every untrusted entry point.
- **The lock is published with a temp file + `Deno.link`.** `Deno.open
  {createNew}` is atomic for the NAME but publishes an empty file, and a
  racer reading it classifies the lock as corrupt debris and takes it. A test
  caught exactly this during implementation.
- **`max_parallel` defaults to 1 rather than removing parallelism.** The
  feature is real and some workflows have no repo-touching nodes; the engine
  warns instead of silently mis-attributing guardrail leaks.
- **Generic CLI passthrough requires `--key=value`.** Keeping the detached
  form meant no unknown flag could ever be rejected. Breaking change,
  documented in the error message itself.
- **Loop HITL routing is a callback (`onHitl`), not a direct
  `handleAgentHitl` import**, keeping `loop.ts` free of engine context. The
  decision logic sits in the pure `carriesHitlQuestion` / `hitlFailure`
  helpers so it is testable without a runtime.
- **`onHitl` returning `null` means "I already recorded the failure".**
  `handleAgentHitl` marks the node failed itself and then returns `null`, so
  the first wiring produced two `node_failed` records for one transition and
  the second, generic one overwrote the specific cause. The loop now skips its
  own `nodeFailed` call on `null` and carries the recorded cause into the
  loop-level error via `hitlFailure(..., recordedError)`. Every early exit in
  the engine's router records before returning `null`.
- **The "no env values in the journal" fix is locked by a full `Engine.run()`,
  not by a replay assertion.** Replay tests build events by hand, so they stay
  green when the engine starts writing `env` again — a mutation confirmed 176
  tests passing with the leak reinstated. The lock runs a worktree-disabled
  merge-only workflow with a secret in the `env:` block and another in
  `--env`, then scans the raw `journal.jsonl` for both values.

### Follow-up owned by the operator

- Rotate the Telegram bot token exposed in the pre-existing run journal. Past
  run artefacts were left untouched — rewriting an append-only journal of a
  finished run is worse than rotating the credential.
