# ADR-0002: HITL detection lives in `@korchasa/ai-ide-cli`, not in the engine

## Status

Proposed

## Context

Human-in-the-loop (FR-E8) is implemented today by code split awkwardly
across two repos. The engine owns `hitl.ts`, `hitl-handler.ts`, and
`hitl-mcp-command.ts`; the sibling library
[`korchasa/ai-ide-cli`](https://github.com/korchasa/ai-ide-cli) owns
the streaming NDJSON parser and runtime adapter (FR-E44). HITL trigger
detection — "when does an `AskUserQuestion` tool_use event from the
agent become an engine-side pause" — straddles the boundary: the
engine watches every adapter event and dispatches to its own HITL
handler when it sees the magic tool name. The detection logic
duplicates knowledge the library already has (which adapter, which
event shape, which tool-call payload schema), and it forces every
new adapter contributor to update both repos in lock-step.

Triggering forces:

- Task `documents/tasks/2026-05-01-hitl-detection-to-cli-lib.md` (cross-
  repo coordination required).
- A new adapter (e.g., Cursor) cannot ship HITL support without an
  engine release because the detection lives in engine code.
- The `RuntimeInvokeOptions.hitlMcpCommandBuilder` callback (FR-E44 AC4)
  was added precisely because the library couldn't reach into the
  engine to spawn its own HITL helper. Detection should follow the same
  callback-based ownership flip.

## Decision

Move HITL trigger detection into `@korchasa/ai-ide-cli`. The library
gains an `onHitlRequest` callback in `RuntimeInvokeOptions`; adapters
emit a normalized `HitlRequest` payload (question text, allowed
answers, run-id, source event) and invoke the callback. The engine
supplies the callback when invoking adapters and resumes via existing
machinery. Engine deletes inline tool-name matching and event
introspection. The MCP-server-spawn callback
(`hitlMcpCommandBuilder`) stays exactly as-is — orthogonal contract.

## Consequences

- **Positive.** Engine stops knowing the on-the-wire shape of any
  particular adapter's HITL events. Library can ship a new adapter
  with full HITL support in one release. Test surface shrinks: HITL
  detection is unit-testable in the library against fixture event
  streams; engine tests only cover the callback wiring.
- **Negative.** Cross-repo release dance — library minor release ships
  first, engine pins the new version. While the library is at the
  older version, the engine cannot delete its detection code (back-
  compat shim required for one release cycle). Library version pin in
  `deno.json#imports` becomes a load-bearing coordination point.
- **Invariants.** `engine/*.ts` MUST NOT pattern-match on raw adapter
  event payloads. The engine sees only normalized `HitlRequest`
  objects. Audit test (planned) greps engine files for the literal
  string `"AskUserQuestion"` and asserts zero matches.

## Alternatives Considered

- **Keep detection in engine, expose a registry of "HITL tool
  names".** Rejected — every new adapter still requires an engine
  registry update; the cross-repo coupling is unchanged in substance.
- **Move HITL **handling** (not just detection) into the library.**
  Rejected — the resume path involves engine state, run-id resolution,
  and `state.json` mutations the library cannot own without re-pulling
  engine concerns. Detection is the natural seam.
- **Bidirectional event bus / message broker.** Rejected — vastly
  oversized for two repos with one consumer relationship.
