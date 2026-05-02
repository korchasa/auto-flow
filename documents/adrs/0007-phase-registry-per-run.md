# ADR-0007: PhaseRegistry is per-`Engine.run()`, never module-level

## Status

Accepted

## Context

FR-E9 introduced a `nodeId → phase` mapping that drives where each
node's artifacts land under `<run-dir>/<phase>/<node-id>/`. The first
implementation kept the mapping in module-level state — a top-level
`Map<string, string>` populated at config load and read by every
path helper.

That worked while every Deno process hosted exactly one
`Engine.run()` call (the bin entry-point case: `cli.ts`,
`scripts/self-runner.ts`). It broke for library hosts.

Triggering force: `flowai-center` (a future host) drives a sequential
queue of `Engine.run()` calls in one Deno process. Run A loaded its
phases, Run B loaded its phases on top. The module map was union-
of-both, so Run B's nodes routed into Run A's phase folders, breaking
artifact isolation across runs that never overlapped in time.

## Decision

`PhaseRegistry` is a class with `fromConfig(config)` and `empty()`
factories and a private `Map<string, string>`. `Engine.run()` builds
a fresh registry from the loaded config at the top of each
invocation and threads it through `EngineContext.phaseRegistry` to
every path-helper call (`getNodeDir`, `buildTaskPaths`,
`node-dispatch`). Path helpers accept the registry as an optional
parameter; when omitted they behave as if the registry were empty
(back-compat for legacy callers and dry-run summaries).

No module-level mutable state remains.

## Consequences

- **Positive.** Two consecutive `Engine.run()` calls in the same Deno
  process keep their phase mappings strictly isolated — Run B's path
  computations are derived from Run B's `phases:` (or per-node
  `phase:` fields) only. Library embedding (FR-E59/E60/E61) becomes
  safe for sequential workloads.
- **Negative.** Every path helper grew an extra parameter. Older test
  fixtures that built paths via these helpers had to be updated to
  pass either the registry or `PhaseRegistry.empty()`. Parallel
  `Engine.run()` calls in one process are still NOT supported — the
  host serializes them in its queue (cf. FR-E59 motivation).
- **Invariants.** `engine.ts` MUST construct a fresh registry per
  `runWithLock` invocation. Path helpers MUST NOT reach into module
  scope for phase information. Test `engine_test.ts::Engine — back-
  to-back runs do not leak phase mapping (FR-E59)` exercises the
  isolation directly.
- **Cross-link.** Implements FR-E59 (see
  `documents/requirements-engine/06-distribution-and-housekeeping.md`
  §3.59). Companion to FR-E60 (caller-supplied `ProcessRegistry`
  injection) and FR-E61 (signal-handler boundary; ADR-0008) — the
  three together make the engine safely embeddable in a host process.

## Alternatives Considered

- **AsyncLocalStorage / context-passing instead of explicit
  parameter.** Rejected — Deno lacks a stable AsyncLocalStorage
  primitive at parity with Node, and threading via parameter is
  trivial once the registry exists. Explicit parameter also makes
  the dependency visible to readers.
- **Reset the module-level map at the start of every
  `Engine.run()`.** Rejected — concurrency-unsafe (parallel runs in
  one process would still race), and "clear global state on entry"
  is a code smell that always rots. Per-instance state is
  unambiguous.
- **One registry per workflow folder, cached across runs.**
  Rejected — couples the registry's lifetime to a process-wide
  identifier and reintroduces the leak when the same workflow is
  edited mid-process (e.g., a host that hot-reloads YAML).
