---
implements:
  - FR-E85  # candidate new FR — "non-blocking resume_node (wait flag)"
---
# Wire `supervisor` to MCP Tools + Non-Blocking Resume

## Goal

Let the `supervisor` agent drive a run through the embedded MCP server
(FR-E73/E84) instead of the brittle `nohup flowai-workflow run … &` +
SIGPIPE-avoidance + log-scraping protocol. Replace ~50 lines of Bash daemon
choreography with typed tool calls, while keeping Bash as a fallback for hosts
where the isolated subagent thread cannot reach the MCP server. Prerequisite:
close the one gap that blocks a full migration — a NON-BLOCKING resume (today
`resume_node` blocks for the whole run; only fresh `start_run` is non-blocking).

## Overview

### Context

- FR-E84 added `start_run` (background `wait:false` → returns `{run_id, pid}`;
  blocking `wait:true`). Committed on branch `task-add-mcp-start-run`.
- The `supervisor` agent (`plugin-src/shared/agents/supervisor.md`) still:
  - launches via `nohup flowai-workflow run … &` (`:38-41,55-59`);
  - scrapes `run_id` from logs / newest-mtime dir (`:68-76`);
  - carries a whole "never pipe into head → SIGPIPE kills the engine" section
    (`:60-67`);
  - polls `state.json`/`journal.jsonl` by file read (`:77-80`) and checks
    liveness via `kill -0 <pid>` (`:81-85`).
  - `tools:` frontmatter is `Read, Grep, Glob, Bash, Write, Edit` (`:4`) — NO
    MCP tools, so it physically cannot call them today.
- MCP tools map 1:1 onto that protocol: `start_run`(fresh), `resume_node`
  (recovery — but BLOCKS), `get_state`, `tail_artifacts`, `list_runs`,
  `cancel_run`, `provide_human_input`, `get_workflow`.
- `resume_node` blocks (`commands.resumeRun` → in-process `Engine.run()`);
  SDS §5.7 left non-blocking resume deferred. `buildEngineRunCommand`
  (`commands.ts:253`) is fresh-only (`run <wf> --run-id <id>`).
- `orchestrator` is policy-only and is explicitly forbidden from reading
  `runs/**`/`state.json` (`orchestrator.md:34-35`) → it does NOT need run-state
  MCP tools. Phase 3 is therefore a near no-op (documented decision, no wiring).

### Current State

- One engine-resume site: `commands.resumeRun` (`resume:true`, blocking),
  shared by MCP `resume_node` + CLI `run --resume`.
- Codex supervisor twin:
  `plugin-src/codex/plugins/flowai-workflow/skills/supervisor/SKILL.md`
  (no `tools:` frontmatter — Codex skills declare `name/description/effort`;
  tool access governed differently). Diverges by concern, not verbatim.
- Attach modes (`supervisor.md:119-`): fresh / attach-live / resume-after-fail.
  `liveLockHolder` (FR-E84) already distinguishes "a live run holds the lock"
  (attach-live → do NOT relaunch) from "lock absent/dead" (resume-after-fail).

### Constraints

- Engine stays domain-agnostic; supervisor stays the only run-driver.
- No silent removal of the Bash path — keep it as an explicit fallback with a
  one-line "MCP unreachable from this subagent thread" guard.
- `resume_node` schema change must be back-compatible (current callers block).
- Codex twin kept in sync by concern (per AGENTS.md plugin-agents note).
- Edits to a shared agent must be applied to every copy or divergence noted.

## Definition of Done

### Phase 1 — Non-blocking resume (engine, FR-E85)

- [ ] (FR-E85) `resume_node` accepts `wait` (default true = current blocking
      behavior). `wait:false` launches a detached `run <wf> --resume <id>` and
      returns `{run_id, pid, wait:false}` — Test: `src/mcp/mcp-server_test.ts` — Evidence: `deno task check`
- [ ] (FR-E85) Background resume lives in `commands.ts` reusing a generalized
      `buildEngineRunCommand` (fresh `--run-id` | recovery `--resume`) — Test: `src/mcp/commands_test.ts` — Evidence: `deno task check`
- [ ] (FR-E85) `wait:false` resume rejects when a LIVE run holds the lock
      (that is attach-live, not resume) via `liveLockHolder` — Test: `src/mcp/commands_test.ts` — Evidence: `deno task check`
- [ ] SRS FR-E85 section + SDS §5.2/§5.7 updated (resume now has a
      non-blocking variant) — Evidence: `deno publish --dry-run`

### Phase 2 — Supervisor → MCP (sdlc/plugin)

- [ ] `supervisor.md` `tools:` adds
      `mcp__plugin_flowai-workflow_flowai-workflow__*` (start_run, resume_node,
      get_state, tail_artifacts, list_runs, cancel_run, provide_human_input,
      get_workflow) — Evidence: `plugin-src/shared/agents/supervisor.md:4`
- [ ] "Engine is long-running" + "Attach Modes" prose rewritten to MCP-first:
      fresh→`start_run wait:false`, recovery→`resume_node wait:false`,
      poll→`get_state`/`tail_artifacts`/`list_runs`, liveness→`get_state`+lock,
      HITL→`provide_human_input`; Bash kept as explicit fallback — Evidence: `plugin-src/shared/agents/supervisor.md`
- [ ] Codex twin `…/skills/supervisor/SKILL.md` updated by concern — Evidence: file diff
- [ ] AGENTS.md supervisor/attach-mode notes reflect MCP-first + Bash fallback — Evidence: `AGENTS.md`
- [ ] Payload build still classifies both files correctly — Test: `scripts/build-plugin-payload_test.ts` — Evidence: `deno task check`

### Phase 3 — Orchestrator (decision, no wiring)

- [ ] Record in AGENTS.md / this task that `orchestrator` stays Bash/report-based
      (policy-only, forbidden from `runs/**`) — no MCP tools added — Evidence: `AGENTS.md`

- [ ] `deno task check` green; `deno publish --dry-run` clean — Evidence: `deno task check`

## Solution

### Phase 1 design fork — how to expose non-blocking resume

Recommended **V1: `wait` flag on `resume_node`** (symmetric with `start_run`).
- Schema: `{ run_id, wait?: boolean }`, `wait` default **true** (back-compat:
  existing blocking callers unchanged). `wait:false` → background detached
  resume, returns `{run_id, pid, wait:false}`.
- Pros: symmetric with `start_run`, one resume tool, additive/back-compat.
- Cons: schema change to `resume_node` (mitigated by default true).
- Alternatives (NOT chosen): V2 separate `resume_run_background` tool (surface
  bloat, two resume paths); V3 unify start+resume into one `launchRun` core
  (bigger refactor — old "variant C", over-scope now). Override here if desired.

### Phase 1 implementation

1. `src/mcp/commands.ts`:
   - Generalize `buildEngineRunCommand(workflowDir, runId, { prompt?, resume? })`
     (or add `buildEngineResumeCommand`) → emits `run <wf> --resume <id>` when
     resuming, `run <wf> --run-id <id> [--prompt …]` when fresh. Keep the same
     dev/prod exec branch.
   - Add `resumeRunBackground({ workflowDir, runId })`: pre-check
     `liveLockHolder` → if a live run holds the lock, throw "run is already
     live (attach, do not resume)"; else spawn detached resume, `child.unref()`,
     return `{ run_id, pid }`.
   - `resumeRun` (blocking) stays the single `Engine({resume:true})` site.
2. `src/mcp/mcp-server.ts`: `registerResumeNode` schema gains
   `wait: z.boolean().default(true)`; `wait:false` → `resumeRunBackground`,
   else current `resumeRun`. Update tool description + module header.
3. Docs: SRS new `### 3.85 FR-E85` (canonical fields, `**Tests:**` line);
   SDS §5.2 `resume_node` bullet + §5.7 note (resume non-blocking variant now
   realised). SRS index map + section prose.

### Phase 1 TDD

- `commands_test.ts`: `buildEngineRunCommand` resume path emits `--resume`;
  `resumeRunBackground` returns run_id+pid without blocking (real detached
  spawn against a tmp workflow, reap via `Deno.kill`); rejects when a live lock
  is present.
- `mcp-server_test.ts`: `resume_node` advertised with `wait` param;
  no-workflow mode still errors; `wait:false` returns the background shape.
- All new test names start with `FR-E85 ` (regression anchor).

### Phase 2 implementation (after Phase 1 ships)

1. `supervisor.md` frontmatter `tools:` += the seven/eight MCP tool ids.
2. Rewrite operational prose:
   - **fresh** → `start_run { wait:false }` → read `run_id`/`pid` from the
     tool result (delete the log-scrape + newest-mtime + SIGPIPE section).
   - **resume-after-fail** → patch root cause outside `runs/<id>/`, then
     `resume_node { run_id, wait:false }`.
   - **attach-live** → `get_state`/`list_runs` to confirm, do NOT relaunch.
   - **poll** → `get_state` + `tail_artifacts` (+ `list_runs`).
   - **liveness** → `get_state` status + lock holder (no `kill -0`).
   - **HITL** → `provide_human_input`.
   - **Fallback** → one guarded block: "if MCP tools are unavailable in this
     thread, fall back to the Bash daemon protocol below" (keep the existing
     Bash text, demoted under the fallback heading).
3. Mirror into the Codex twin SKILL.md by concern (worker-spawn framing).
4. Sync AGENTS.md supervisor notes (attach modes, MCP-first + fallback).

### Phase 3

Document-only: `orchestrator` stays as-is. No `tools:`/prose change.

### Verification

`deno task check` (incl. `build-plugin-payload_test.ts`, `publish --dry-run`),
then a manual host smoke: in a Claude session, `/flowai-workflow:supervise`
a fresh run and confirm the supervisor calls `start_run`/`get_state` (not
`nohup`). No stray `deno.lock`/worktree artefacts from tests.

## Sequencing / Dependencies

- Phase 1 MUST land before Phase 2 (supervisor's resume path depends on the
  non-blocking `resume_node`).
- Phase 1 is engine-scope (own PR possible); Phase 2 is sdlc/plugin-scope;
  Phase 3 is doc-only. Could be one mixed `engine+sdlc:` change or split
  Phase 1 (engine) from Phases 2-3 (sdlc).
- Independent of the unpushed FR-E84 branch `task-add-mcp-start-run`, but
  builds on it — rebase Phase 1 onto that branch (or onto main after it merges).
