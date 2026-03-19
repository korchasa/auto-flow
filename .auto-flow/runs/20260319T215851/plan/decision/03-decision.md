---
variant: "Variant B: SDLC wrapper script with explicit warning logging"
tasks:
  - desc: "Create run-dashboard.sh wrapper script"
    files: [".auto-flow/scripts/run-dashboard.sh"]
  - desc: "Replace || true with wrapper script in pipeline.yaml after field"
    files: [".auto-flow/pipeline.yaml"]
---

## Justification

I selected Variant B for the following reasons:

1. **Accurate node status preserved.** Variant A marks the node as "failed"
   when only the after-hook (dashboard generation) failed — the agent itself
   succeeded. This creates a false "failed" signal in state.json and dashboard,
   contradicting the actual outcome. Variant B's always-exit-0 wrapper keeps
   the node "completed" (accurate), while surfacing the dashboard failure via
   `[WARN]` log in stderr (captured in `stream.log`).

2. **Satisfies all 3 FR-S36 requirements.** (a) Warning-level log on non-zero
   exit — `[WARN] dashboard generation failed (exit $code)` to stderr.
   (b) Non-blocking behavior retained — wrapper always exits 0. (c) Run output
   indicates failure — warning appears in stream.log, visible via FR-S34 inline
   log viewer in the dashboard.

3. **Domain-agnostic engine boundary respected (AGENTS.md vision).** No engine
   changes required. The wrapper is a pipeline-level concern — a shell script
   in `.auto-flow/scripts/`, invoked via `after:` config. This aligns with the
   project vision: "no git/GitHub/SDLC logic in engine; any workflow expressible
   as a DAG of agent/merge/loop/human nodes."

4. **Variant C over-engineers.** The `dashboard-error.txt` artifact has no
   current consumer. Adding it creates a maintenance surface with no immediate
   value. If structured error signaling becomes necessary, it should be an
   engine-level FR (deferred per spec scope boundaries).

## Task Descriptions

### Task 1: Create `run-dashboard.sh` wrapper script

New file `.auto-flow/scripts/run-dashboard.sh`. Shell script that:
1. Receives `$1` as the run directory path (from `{{run_dir}}` template).
2. Runs `deno task dashboard --run-dir "$1"`, capturing exit code.
3. If exit code != 0: prints `[WARN] dashboard generation failed (exit $code)`
   to stderr (captured in `stream.log` by engine).
4. Always exits 0 — ensures node remains "completed."
5. Must be executable (`chmod +x`).

### Task 2: Replace `|| true` with wrapper script in `pipeline.yaml`

Modify `.auto-flow/pipeline.yaml` `tech-lead-review` node's `after:` field:
- Old: `deno task dashboard --run-dir {{run_dir}} || true`
- New: `.auto-flow/scripts/run-dashboard.sh {{run_dir}}`

No other pipeline config changes. `on_error: continue` and `run_on: always`
remain as-is (retained per FR-S36 requirement #2).

## Summary

I selected Variant B (SDLC wrapper script with explicit warning logging) over
Variant A (false "failed" status) and Variant C (over-engineered artifact).
2 tasks: create wrapper script, update pipeline.yaml after field. Branch
`sdlc/issue-154` created, draft PR opened.
