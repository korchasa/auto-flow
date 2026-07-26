# Module: engine

DAG executor core: level scheduling, node dispatch, agent invocation,
loop bodies, human nodes, post-workflow hooks.

- `engine.ts` — `Engine.run()`: worktree setup, lock, state/journal, level
  loop, budget enforcement, summary.
- `dag.ts` — toposort into levels; cycle detection.
- `node-dispatch.ts` — per-node-type executors; the only place engine
  context is translated into `runAgent`/`runLoop`/`runHuman` calls.
- `agent.ts` — one agent node: invoke → validate → continue (`--resume`).
- `loop.ts` — iterative body with a frontmatter exit condition.
- `node-lifecycle.ts`, `post-workflow.ts`, `stream-log.ts`, `human.ts`.

## Key decisions

- **Levels run sequentially by default.** See `config/AGENTS.md` on
  `max_parallel`; `warnUnsafeParallelism` surfaces the guardrail risk when an
  author opts into concurrency.
- **HITL is terminal for the turn.** `runAgent` returns
  `success: true` + `hitl_question` with NO artifact written. Every caller
  must route it: `executeAgentNode` directly, `runLoop` through its `onHitl`
  hook. A caller that ignores it fails the node (`hitlFailure`) rather than
  advancing on an answer that will never arrive.
- **`processRegistry` is threaded to EVERY `runAgent` call**, loop bodies
  included, so an embedding host's `killAll()` reaches all subprocesses
  (FR-E60).
- **The engine never installs signal handlers** (FR-E61) — bin entry points
  own signal routing.
- **Merge nodes only tolerate a missing input directory.** Any other copy
  failure aborts the node instead of silently producing an empty merge.
- **Budget checks record a terminal journal fact before rethrowing**, so an
  over-budget run never leaves `run_started` as the journal's last word.
