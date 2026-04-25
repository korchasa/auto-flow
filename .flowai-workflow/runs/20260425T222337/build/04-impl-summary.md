## Summary

### Files Changed

#### Iteration 1

- **types.ts** — Added optional `claude_cli_version?: string` field to `RunState` for operator auditability (FR-E49)
- **agent.ts** — Added exported `buildSpawnEnv(nodeEnv?)` function that merges node-level env with engine-enforced `DISABLE_AUTOUPDATER=1` (engine wins on conflict); wired into both initial and continuation `adapter.invoke()` calls in `runAgent()`
- **hitl.ts** — Updated import to include `buildSpawnEnv`; wired `env: buildSpawnEnv(opts.node.env)` into `runtimeRun()` call in HITL resume path
- **loop.ts** — Added optional `env?` field to `LoopRunOptions` for API completeness (FR-E49); loop body agents get `DISABLE_AUTOUPDATER=1` automatically via `runAgent()`'s internal `buildSpawnEnv()` call
- **engine.ts** — Added `captureClaudeVersion()` helper that runs `claude --version`, parses first semver token, handles graceful failure; wired into `runWithLock()` after phase registry init and initial state save

#### Iteration 2 (QA fix)

- **loop.ts** — Added `env: opts.env` to `runAgent()` call inside `runLoop()`, forwarding `LoopRunOptions.env` to body node agent invocations (fixed dead-field issue from QA iter 1)
- **agent.ts** — Added `env?: Record<string, string>` field to `AgentRunOptions`; updated `runAgent()` to destructure `env` and pass merged `{ ...(node.env ?? {}), ...(env ?? {}) }` to `buildSpawnEnv()`, enabling callers to inject extra env vars below the engine-enforced `DISABLE_AUTOUPDATER=1`

### Tests Added or Modified

#### Iteration 1

- **agent_test.ts** — Added 5 unit tests for `buildSpawnEnv()`: always includes `DISABLE_AUTOUPDATER=1`, merges user env, engine wins on conflict, handles undefined/empty nodeEnv
- **engine_test.ts** — Added 3 tests for `RunState.claude_cli_version`: optional field accepts string, roundtrips through JSON serialization, absent from JSON when undefined

#### Iteration 2 (QA fix)

- **loop_test.ts** — Added 2 tests: "LoopRunOptions — env field accepted and forwarded", "LoopRunOptions — env is optional"
- **agent_test.ts** — Added 1 test: "buildSpawnEnv — merges node.env and caller env, engine wins"

### deno task check result

PASS — `=== All checks passed! ===`
