## Summary

### Files Changed

- `types.ts` — Added optional `claude_cli_version?: string` field to `RunState` interface (FR-E49).
- `engine.ts` — Added `buildSpawnEnv()` exported helper (returns process env with `DISABLE_AUTOUPDATER=1` forced); modified `run()` to set `DISABLE_AUTOUPDATER=1` before execution and restore original value in `finally` block; added non-fatal `claude --version` capture into `state.claude_cli_version`.

### Tests Added or Modified

- `engine_test.ts` — Added 3 new tests: `buildSpawnEnv` returns `DISABLE_AUTOUPDATER=1`; user-set value is overridden; `Engine.run()` restores env after completion (FR-E49). Updated import to include `buildSpawnEnv`.
- `state_test.ts` — Added 1 new test: `claude_cli_version` persists through `saveState` → `loadState` JSON roundtrip (FR-E49).

### deno task check Result

PASS — `=== All checks passed! ===`
