# Tech Lead Review — PR #212

## Verdict: OPEN

## CI Status
- CI (GitHub Actions): 5/5 runs completed — success

## Findings

### Blocking

1. **FR-E49 absent from SRS** — `documents/requirements-engine/04-runtime-and-hooks.md` contains 0 matches
   for "FR-E49"; `documents/requirements-engine.md` index has no FR-E49 row. Both updates were
   explicitly required by the spec (`01-spec.md` §SRS Changes). This is the same PM-persistence-failure
   pattern seen in 27+ prior issues: PM agent wrote the SRS changes in the spec but never persisted them
   to the actual files. Developer must add:
   - New §3.49 section in `documents/requirements-engine/04-runtime-and-hooks.md`
   - FR-E49 row in `documents/requirements-engine.md` index table

### Non-blocking

2. **`HitlRunOptions` lacks `env` field** (`hitl.ts:267`) — `buildSpawnEnv(opts.node.env)` called
   correctly, but caller-level env cannot be passed through because `HitlRunOptions` has no `env` field
   analogous to `AgentRunOptions.env`. Out of decision scope — document for future FR.

3. **Double `saveState` in `engine.ts`** — state saved once before version capture and once after.
   Extra write per run start; functional and matches graceful-failure design per spec. Non-blocking.

4. **`loop_test.ts` env tests** verify TypeScript type acceptance but not behavioral forwarding to
   spawned process. `env: opts.env` at `loop.ts:206` is correct; full behavioral test requires
   subprocess mock. Non-blocking.

## Scope Check
- In scope: `types.ts` (RunState field), `agent.ts` (buildSpawnEnv + wire), `hitl.ts` (wire),
  `loop.ts` (LoopRunOptions.env + AgentRunOptions.env + forward), `engine.ts` (captureClaudeVersion),
  `agent_test.ts` + `engine_test.ts` + `loop_test.ts` (tests), SRS index + 04-runtime-and-hooks.md
- Out of scope (not touched, correctly): non-Claude runtimes, cross-run pinning, SDS update

## Working Tree
- Clean: yes
- Uncommitted files: none

## Summary

OPEN — QA FAIL: 1 blocking issue (FR-E49 section and index row absent from SRS). All behavioral ACs pass,
741 tests pass, CI green, tree clean. PR left open pending SRS update.
