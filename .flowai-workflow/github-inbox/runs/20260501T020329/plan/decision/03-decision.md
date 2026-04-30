---
variant: "Variant C: Hybrid — engine Deno.env + buildSpawnEnv helper"
tasks:
  - desc: "Add claude_cli_version field to RunState type"
    files: ["types.ts"]
  - desc: "Implement buildSpawnEnv() helper and version capture in engine.ts"
    files: ["engine.ts"]
  - desc: "Add unit tests for buildSpawnEnv and version capture"
    files: ["engine_test.ts"]
  - desc: "Add state roundtrip test for claude_cli_version"
    files: ["state_test.ts"]
---

## Justification

I selected **Variant C** over A and B for these reasons:

1. **Library-embedding safety (FR-E59/E60/E61):** Variant A mutates `Deno.env`
   without cleanup — in library-embedding scenarios the host process retains
   `DISABLE_AUTOUPDATER=1` after `Engine.run()` returns. Variant C adds
   restore-on-exit in a `finally` block, limiting blast radius to the run
   duration. Per AGENTS.md: "Engine is safe to embed in a host Deno process
   that runs sequential `Engine.run()` calls alongside other long-lived
   subsystems" — restore-on-exit upholds this contract.

2. **No cross-repo coordination (vs Variant B):** Variant B requires adding
   `env` to `RuntimeInvokeOptions` in `@korchasa/ai-ide-cli` — two PRs, two
   publishes, version pin bump. Variant C is engine-only. Per AGENTS.md key
   decision: "Engine is domain-agnostic" — the `DISABLE_AUTOUPDATER` env var
   is Claude-specific operational safety, not a generic runtime capability
   that belongs in the library.

3. **Testable helper:** `buildSpawnEnv()` is a pure function returning an env
   record. Unit-testable without subprocess spawning. Satisfies FR-E49 ACs 5-6
   directly. If the library later adds `env` to `RuntimeInvokeOptions`, this
   helper becomes a one-line delete.

4. **Sequential-only contract makes mutation safe:** Parallel `Engine.run()`
   calls are NOT supported (FR-E60). `Deno.env` mutation with restore-on-exit
   is race-free under this contract.

## Task Descriptions

### Task 1: Add `claude_cli_version` to RunState

Add optional `claude_cli_version?: string` field to `RunState` in `types.ts`.
No behavioral change — just the type extension. `createRunState()` in
`state.ts` already uses spread, so the field persists through save/load
without `state.ts` code changes.

### Task 2: Implement `buildSpawnEnv()` and version capture

In `engine.ts`:
- `buildSpawnEnv()`: private helper returning `Record<string, string>` with
  `DISABLE_AUTOUPDATER=1` merged over `Deno.env.toObject()`. User env does not
  override `DISABLE_AUTOUPDATER`.
- In `run()`, before node execution: call `Deno.env.set("DISABLE_AUTOUPDATER",
  "1")`. Store original value. In `finally` block: restore original (or delete
  if unset).
- Capture `claude --version` via `new Deno.Command("claude", ["--version"])`.
  On success: store trimmed stdout in `state.claude_cli_version`. On failure
  (e.g. `claude` not on PATH — OpenCode runtime): log warning, leave field
  undefined. Non-fatal.

### Task 3: Unit tests for `buildSpawnEnv` and version capture

In `engine_test.ts`:
- `buildSpawnEnv()` returns env containing `DISABLE_AUTOUPDATER=1`.
- User env merge: `DISABLE_AUTOUPDATER` in process env does NOT override the
  engine-set value.
- Env restore on exit: after `run()` completes, `Deno.env.get("DISABLE_AUTOUPDATER")`
  returns the original value (or `undefined`).

### Task 4: State roundtrip test

In `state_test.ts`:
- `claude_cli_version` persists through `saveState()` → `loadState()` roundtrip.

## Summary

Selected Variant C (Hybrid — engine `Deno.env` + `buildSpawnEnv` helper) for
FR-E49 (CLI Auto-Update Prevention). 4 tasks across `types.ts`, `engine.ts`,
`engine_test.ts`, `state_test.ts`. Engine-only change — no cross-repo
coordination. Restore-on-exit preserves library-embedding safety (FR-E59/E60/E61).
Branch `sdlc/issue-196`, draft PR #209 updated.
