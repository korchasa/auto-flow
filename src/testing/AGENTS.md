# Module: testing

Test-only runtime seam (FR-E86). Replaces the AGENT, not the engine, so
engine-owned logic — validation, continuation, resume, scope guardrail, HITL
routing, state, journal, cost aggregation — runs end-to-end in CI without an
agent turn.

- `fake-runtime.ts` — `createFakeRuntime(handler, {id, capabilities})` builds a
  `RuntimeAdapter` driven by a TypeScript function. Inject via
  `EngineOptions.runtimeAdapter` (whole run), or `runAgent` / `runLoop` /
  `handleAgentHitl` (single node).

## Key decisions

- **Handler function, not a scripted data structure.** One function asserts on
  the `RuntimeInvokeOptions` it receives AND generates the reply, with full
  control over timing (stall until the FR-E80 retry budget fires, resolve after
  abort, throw mid-turn). A data scenario would need a new mini-language per
  case. Branching belongs in the test's handler, never in the fake itself.
- **Capabilities default to the real adapter's vector** for the same runtime
  id, so a capability change in `@korchasa/ai-ide-cli` surfaces in fakes
  instead of drifting from production. Default id is `opencode` — it keeps the
  FR-E81 `claude --version` preflight out of tests.
- **No ACP-front emulation.** Handshake, wire errors and real process kill are
  deliberately out of scope: a fake front can only encode our beliefs about the
  protocol, and the observed front-level defects (`-32700`, dropped
  `resumeSessionId`) were exactly where those beliefs were wrong. That band
  belongs to `@korchasa/ai-ide-cli`.
- **No workflow-config surface.** `workflow.yaml` cannot select a fake, so a
  real run can never execute against one.
- **Never shipped.** Excluded from the JSR tarball via
  `deno.json#publish.exclude`.
