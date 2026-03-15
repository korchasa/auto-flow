# FR-18: Verbose Output (`-v`)

## Problem

Current verbose mode (`-v`) only shows lifecycle events (node started/completed/failed) and streams agent stderr. Debugging pipeline issues or understanding agent behavior requires reading log files after the fact. The `-v` flag should provide full transparency into every step.

## Required Behavior

When `-v` is passed, the engine must show additional detail at each stage of execution:

1. **Full task prompt** — after template interpolation, print the complete prompt text sent to each agent.
2. **Input artifacts** — for each node, list resolved input artifact file paths with file sizes (bytes).
3. **Validation rule execution** — show which rules ran, pass/fail per rule, and failure details.
4. **Continuation context** — when continuation is triggered, show why and what error text is appended.
5. **Agent stdout streaming** — already implemented (stderr streams via `onOutput`). Verify it works.
6. **Safety check results** — show which files were diffed, allowed paths, and any violations found.
7. **Commit details** — show files staged, commit message, and branch name.

Default mode (no `-v`) must remain concise: node start/complete/fail + summary.

## Scope

### Files to modify

- `.auto-flow/engine/output.ts` — add verbose-only logging methods:
  - `verbosePrompt(nodeId, prompt)` — print full prompt text
  - `verboseInputs(nodeId, inputs: {path, size}[])` — print input artifact list
  - `verboseValidation(nodeId, results: {rule, passed, detail?}[])` — print validation results
  - `verboseContinuation(nodeId, iteration, error)` — print continuation context
  - `verboseSafety(nodeId, allowedPaths, violations)` — print safety check results
  - `verboseCommit(nodeId, files, message, branch)` — print commit details

- `.auto-flow/engine/agent.ts` — emit verbose events:
  - Before invoking claude CLI: emit the interpolated task prompt
  - On continuation: emit the continuation reason and error text
  - Pass verbose callbacks via `AgentRunOptions`

- `.auto-flow/engine/engine.ts` — emit verbose events:
  - Before agent execution: resolve and emit input artifact paths+sizes
  - After validation: emit validation rule results
  - After safety check: emit safety check details
  - After commit: emit commit details (files, message, branch)

- `.auto-flow/engine/validate.ts` — return structured results (rule name + pass/fail + detail) instead of just boolean, so engine can log them in verbose mode. Check if `ValidationResult` already has this info.

- `.auto-flow/engine/git.ts` — return structured info from `commitNodeChanges` and `safetyCheckDiff` for verbose logging.

### Tests to write/update

- `.auto-flow/engine/output_test.ts` — test new verbose methods: verify they output when verbose, silent when not
- `.auto-flow/engine/agent_test.ts` — verify verbose callbacks are invoked
- `.auto-flow/engine/engine_test.ts` — verify verbose output during node execution

## Out of Scope

- Changes to `-q` (quiet) mode behavior
- Changes to pipeline YAML configs
- Changes to legacy shell scripts in `.auto-flow/scripts/`
- Adding new CLI flags
