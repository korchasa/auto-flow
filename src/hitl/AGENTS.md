# Module: hitl

Human-in-the-loop: capture an agent's question, deliver it, wait for a
reply, resume the same session with it.

- `hitl.ts` — `runHitlLoop`: ask → poll → resume; owns the local inbox
  channel and the `check_script` transport.
- `hitl-handler.ts` — `handleAgentHitl`: the two entry modes, `detect`
  (question just raised) and `resume` (node rehydrated from `waiting`).
- `hitl-injection.ts` — per-invocation MCP server + tool-use observer.
- `hitl-mcp-server.ts` — the `request_human_input` tool the agent calls.

## Key decisions

- **Capture aborts the turn.** The observer intercepts the tool call, so the
  node's artifact does not exist yet. Callers must route the question rather
  than read `success: true` literally — see `engine/AGENTS.md`.
- **A local inbox reply beats `check_script`.** `provide_human_input` / CLI
  `answer` write `<runDir>/.hitl-inbox/<nodeId>.txt` atomically; the poll
  loop consumes the file on pickup so a later round cannot re-answer with a
  stale reply.
- **`poll_interval` and `timeout` are validated at config load**, because
  both feed arithmetic here and a missing value silently produced `NaN`
  deadlines and a loop that never ran.
- **The audit record is appended BEFORE resume**, so a crash mid-resume still
  leaves the Q+A on disk for post-mortems.
- **Run-dir paths passed to scripts are absolute** — scripts run with
  `cwd = worktree`, where the project-root run-dir does not exist.
