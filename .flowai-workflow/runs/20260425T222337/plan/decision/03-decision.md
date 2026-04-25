---
variant: "Variant A: Engine-level env builder in agent.ts"
tasks:
  - desc: "Add claude_cli_version field to RunState in types.ts"
    files: ["types.ts"]
  - desc: "Add buildSpawnEnv() in agent.ts alongside applyBudgetFlags()"
    files: ["agent.ts"]
  - desc: "Wire buildSpawnEnv() into adapter.invoke() calls (initial + continuation) in agent.ts"
    files: ["agent.ts"]
  - desc: "Wire buildSpawnEnv() into HITL resume path in hitl.ts"
    files: ["hitl.ts"]
  - desc: "Thread env through LoopRunOptions to inner runAgent() calls in loop.ts"
    files: ["loop.ts"]
  - desc: "Capture claude --version at run start in engine.ts, store in RunState"
    files: ["engine.ts"]
  - desc: "Unit tests for buildSpawnEnv() in agent_test.ts"
    files: ["agent_test.ts"]
  - desc: "Integration test for claude_cli_version capture in engine_test.ts"
    files: ["engine_test.ts"]
---

## Justification

I selected **Variant A** over B and C for the following reasons:

1. **Follows established pattern.** `agent.ts` already exports
   `applyBudgetFlags()` — a spawn-parameter helper consumed by both `agent.ts`
   and `hitl.ts`. `buildSpawnEnv()` is the same pattern: engine-invariant spawn
   config co-located with the agent invocation module. Adding a dedicated
   `spawn-env.ts` module (Variant B) for two small functions would be
   over-engineering and inconsistent with the existing colocation idiom.

2. **Minimal file count.** No new modules, no barrel export updates. Aligns
   with AGENTS.md principle: "Engine is domain-agnostic" — `buildSpawnEnv()`
   is a generic env merge utility, not a domain concern. Keeping it in
   `agent.ts` maintains the single-responsibility boundary without module
   proliferation.

3. **Cross-module dependency already exists.** `hitl.ts` already imports
   `applyBudgetFlags` from `agent.ts` (FR-E47). Adding `buildSpawnEnv` to
   the same import is a no-cost extension. Variant C's dispatch-layer approach
   partially defeats centralization since HITL resume bypasses
   `node-dispatch.ts`.

4. **Effort S vs M.** Variant A is the simplest implementation: add one
   function, wire it at 4 spawn sites, add version capture in engine startup.

## Task Descriptions

1. **Add `claude_cli_version` to `RunState`** — extend `RunState` type in
   `types.ts` with optional `claude_cli_version?: string` field. Persisted in
   `state.json` for operator auditability.

2. **Add `buildSpawnEnv()` in `agent.ts`** — exported function:
   `buildSpawnEnv(nodeEnv?: Record<string,string>): Record<string,string>`.
   Merges node-level `env` with engine-enforced `DISABLE_AUTOUPDATER=1`.
   Engine wins on conflict (node cannot override `DISABLE_AUTOUPDATER`).

3. **Wire `buildSpawnEnv()` into `agent.ts` spawn calls** — pass result as
   `env` field to `adapter.invoke()` at both initial invocation and
   continuation/resume paths.

4. **Wire `buildSpawnEnv()` into `hitl.ts`** — import from `agent.ts`, pass
   as `env` to `runtimeRun()` call in HITL resume path.

5. **Thread env through `loop.ts`** — add optional `env` to
   `LoopRunOptions`, forward to inner `runAgent()` calls so loop body agents
   also get `DISABLE_AUTOUPDATER=1`.

6. **Capture `claude --version` in `engine.ts`** — after phase registry init,
   before first node: `Deno.Command("claude", ["--version"])` → parse stdout
   → store in `state.claude_cli_version` → re-save state. Graceful failure
   (log warning, leave field undefined) when CLI not installed.

7. **Unit tests for `buildSpawnEnv()`** — verify: always includes
   `DISABLE_AUTOUPDATER=1`, merges user env, engine wins on conflict,
   handles undefined/empty node env.

8. **Integration test for version capture** — verify `claude_cli_version`
   populated in state after engine startup (mock or subprocess-based).

## Summary

Selected Variant A (engine-level env builder in `agent.ts`). Follows the
established `applyBudgetFlags()` colocation pattern, zero new modules, effort S.
8 tasks ordered by dependency. Branch `sdlc/issue-196-v3` created, draft PR
opened.
