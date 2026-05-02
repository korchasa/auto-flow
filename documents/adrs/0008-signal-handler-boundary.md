# ADR-0008: Engine never installs OS signal handlers; bin entry points only

## Status

Accepted

## Context

`process-registry.ts` (in the `@korchasa/ai-ide-cli` library) ships
`installSignalHandlers()` — wires `Deno.addSignalListener("SIGINT" |
"SIGTERM", …)` to call `killAll()` on the default process registry
and exit with `Deno.exit(130 | 143)`. The standalone bin entry points
(`cli.ts`, `scripts/self-runner.ts`) need this — Ctrl-C must kill
spawned subprocesses cleanly before exit.

But the same engine is meant to be embedded in library hosts that
already own SIGINT/SIGTERM listeners and translate them into queue-
cancellation, graceful-shutdown checkpoints, or other host-specific
flows. If `Engine.run()` quietly installed signal handlers as a side
effect, it would clobber the host's listeners and call
`Deno.exit(130)` mid-host-run, killing unrelated work.

## Decision

`installSignalHandlers()` is publicly documented as bin-entry-point-
only. The `Engine` class MUST NOT call it — neither directly nor
transitively through any of its methods. Bin entry points
(`cli.ts`, `scripts/self-runner.ts`) install handlers themselves
before constructing `Engine`. Library hosts construct `Engine`
without ever touching `installSignalHandlers` and keep full control
over signal routing.

Enforcement is mechanical:

- `process-registry.ts` module-level JSDoc states the contract and
  explicitly disclaims use from `Engine`.
- `engine_test.ts::engine.ts does not import installSignalHandlers`
  asserts at the source level that the engine module has no import of
  the symbol.
- `engine_test.ts::Engine does not install OS signal handlers
  (FR-E61)` runs an end-to-end noop merge workflow with the test
  observing zero signal-listener registrations.

## Consequences

- **Positive.** Library hosts can embed `Engine.run()` without
  defending against unwanted signal-handler installation. The
  bin/library boundary is explicit and lint-checked. Companion to
  FR-E59 (per-run phase registry; ADR-0007) and FR-E60 (caller-
  supplied `ProcessRegistry`) — the three together define the
  embedding contract.
- **Negative.** A new contributor adding a "convenient" handler
  install in `engine.ts` will fail two tests, then need to read the
  contract. (Counter: failing fast at CI is the goal.) Bin entry
  points carry the responsibility for cleanup themselves — but they
  always did; this just makes it explicit.
- **Invariants.** `engine.ts` MUST NOT import
  `installSignalHandlers` from any source. README "Embedding vs
  standalone use" section keeps the user-facing contract in sync.
- **Cross-link.** Implements FR-E61 (see
  `documents/requirements-engine/06-distribution-and-housekeeping.md`
  §3.61).

## Alternatives Considered

- **Make `installSignalHandlers()` a no-op when an existing listener
  is detected.** Rejected — Deno's `addSignalListener` does not
  expose a "list existing listeners" API; fragile cross-runtime
  detection. Explicit boundary is simpler and stronger.
- **Engine installs handlers but exposes an opt-out flag.**
  Rejected — opt-out flips the safe default. The host that forgets
  the flag gets surprising `Deno.exit` calls. Opt-in is safer.
- **Move handler installation to a dedicated `Runtime` wrapper that
  wraps `Engine`.** Rejected for now — pure naming refactor; the
  bin entry points are already the wrapper.
