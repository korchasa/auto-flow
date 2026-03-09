# FR-10: Agent Log Storage

## Problem

The pipeline engine (`deno task run:task`) executes agent nodes and receives
JSON output from the `claude` CLI, but does NOT persist this output to disk.
After each node completes, the log data is lost — only `state.json` is saved.

## Required Behavior

After each agent node completes, the engine must save two files to
`.sdlc/runs/<run-id>/logs/<node-id>.json`:

1. **`<node-id>.json`** — the full `ClaudeCliOutput` JSON object returned by
   `claude --output-format json`. Contains: `result`, `session_id`,
   `total_cost_usd`, `duration_ms`, `duration_api_ms`, `num_turns`, `is_error`.

2. **`<node-id>.jsonl`** — copy of the JSONL session transcript from
   `~/.claude/projects/<project-hash>/`. The correct file is identified by
   `session_id` from the JSON output (filename contains the session_id).

## Scope

- Modify `.sdlc/engine/agent.ts`: return `ClaudeCliOutput` from `runAgent()`
  (already done — it's in `AgentResult.output`)
- Modify `.sdlc/engine/engine.ts`: after `executeAgentNode()` succeeds, save
  `result.output` as JSON to `<run_dir>/logs/<node-id>.json`
- Add `saveAgentLog()` function (to `agent.ts` or a new `log.ts` module) that:
  - Writes `output` as JSON to the logs path
  - Finds the JSONL transcript by scanning `~/.claude/projects/` for a file
    whose name contains `session_id`, copies it to `<run_dir>/logs/<node-id>.jsonl`
  - If JSONL not found: logs a warning, does NOT fail the pipeline
- Write tests for the log-saving logic
- `deno task check` must pass

## Out of Scope

- Loop body nodes (executor, qa) — log saving for loop nodes is deferred
- Changes to shell scripts in `.sdlc/scripts/`
- Changes to pipeline YAML configs
