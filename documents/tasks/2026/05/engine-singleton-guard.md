---
date: "2026-05-01"
status: to do
implements: [FR-E59, FR-E64]
tags: [refactor, engine, concurrency]
related_tasks:
  - 2026/05/engine-decomposition.md
  - 2026/05/phase-registry-per-run.md
---
# engine: Enforce "one Engine.run() per process at a time"

## Goal

Make the parallel-run prohibition a runtime invariant rather than a
documentation contract. Re-entrant `Engine.run()` calls must fail fast
with a clear message instead of corrupting shared state.

## Overview

### Context

Critique #11. AGENTS.md states: "Parallel `Engine.run()` calls in one
process are NOT supported; the host serializes them in its queue." Per-
run `PhaseRegistry` (FR-E59) handles the obvious leak, but
`process-registry.ts` still exposes a default singleton, and
`installSignalHandlers()` mutates global state. If a host violates the
contract, failures will be silent or weird (state-file corruption,
cross-run lock release, signal handler double-install).

### Current State

- No runtime check on overlapping `run()` calls.
- Per-workflow lock (FR-E54) prevents two runs against the same
  workflow folder; offers no protection across folders within one
  process.
- `installSignalHandlers()` is idempotent in spirit but not asserted.

### Constraints

- Single Deno process. The guard is process-scoped (a `let` in the
  engine module), not file-system based.
- Must not interfere with library hosts that legitimately run multiple
  engines in separate Deno workers / subprocesses.
- Must not interfere with `--resume` of a previously interrupted run
  (that's a sequential second invocation, not concurrent).

## Definition of Done

- [ ] Module-scope `let activeRun: { engineId, runId, startedAt } |
      null = null` (or equivalent — `Symbol.for("...")` global if a
      single binary may be loaded twice; pick after measurement).
- [ ] `Engine.run()` first action: if `activeRun !== null`, throw
      `Error("Engine.run() is single-run-at-a-time per process — "
      + "concurrent run already active: <runId> started at
      <startedAt>. See task 2026/05/engine-singleton-guard.md.")`.
- [ ] `finally` block clears `activeRun` (success, failure, exception).
- [ ] Mechanism survives unhandled rejection inside `run()` —
      use `try { ... } finally { activeRun = null; }`.
- [ ] New test in `engine_test.ts` (or post-decomposition equivalent):
      spawn two `engine.run()` promises, expect second to reject with
      the diagnostic message; first proceeds normally.
- [ ] FR-E64 added to engine SRS (Single-Run Process Invariant).
      Acceptance lists the diagnostic contract.
- [ ] AGENTS.md sentence "Parallel `Engine.run()` calls in one process
      are NOT supported" updated to "are rejected at runtime; see
      FR-E64".

## Solution

### Step 1 — Decide guard scope

Two candidates:

- (A) Module-scoped `let activeRun` — simplest, works because Deno
  single-source-loads each module per process. Fails to catch the case
  of one binary loading the engine twice via different specifiers
  (extremely rare; rejected as YAGNI).
- (B) `globalThis[Symbol.for("flowai-workflow:active-run")]` —
  bullet-proof against double-load. Marginal complexity. Pick this
  unless there's a reason not to.

Default to (B); document in this task's frontmatter.

### Step 2 — Implement

Place guard in `engine.ts` (or `RunLifecycle` post-decomposition):
```typescript
const KEY = Symbol.for("flowai-workflow:active-run");
function setActive(info) { (globalThis as any)[KEY] = info; }
function getActive() { return (globalThis as any)[KEY]; }
function clearActive() { (globalThis as any)[KEY] = null; }
```

`Engine.run()`:
```typescript
const existing = getActive();
if (existing) throw new Error(`...`);
setActive({ runId, startedAt: new Date().toISOString() });
try { /* run */ } finally { clearActive(); }
```

### Step 3 — Test

Two-promise concurrency test using a no-op workflow (single human node
that resolves immediately or a tiny dry-run-eligible config). Assert
second promise rejects with the diagnostic.

### Step 4 — Doc

FR-E64, AGENTS.md sentence rewrite.

### Verification

- `deno task check` green.
- New concurrency test passes.
- Existing 4 dogfood workflows still pass sequential runs (no
  regression).
- Manual: trigger a `--resume` immediately after a successful run —
  no false positive.
