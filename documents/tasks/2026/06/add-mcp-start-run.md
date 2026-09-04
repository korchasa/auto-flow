---
date: "2026-06-21"
status: done
implements:
  - FR-E84  # candidate new FR — "MCP start_run tool"; confirmed after variant pick
---
# Add a Workflow-Start Method to the Embedded MCP Server

## Goal

Let an MCP host (Claude Code / Codex) start a **fresh** workflow run through the
embedded MCP server, instead of the host having to spawn `flowai-workflow run`
as a background CLI subprocess and scrape the run-id out of a log file. Closes
the one lifecycle gap in the FR-E73 tool surface: today MCP can observe, resume,
cancel, patch, and answer — but cannot *start*.

## Overview

### Context

- Embedded MCP server `src/mcp/mcp-server.ts` (FR-E73) exposes 8 tools:
  `get_workflow`, `get_state`, `list_runs`, `tail_artifacts`, `resume_node`,
  `cancel_run`, `apply_workflow_patch`, `provide_human_input`. None starts a
  fresh run.
- The only engine-driving tool, `resume_node`, **blocks the MCP request for the
  whole run** (delegates to `commands.resumeRun` → `new Engine({resume:true})` →
  `engine.run()`). SDS `design-engine/05-mcp-server.md:173` lists a *non-blocking*
  run-id-then-poll model as **explicitly deferred / out of scope**.
- Fresh runs are started today by the `supervisor` agent as a **background CLI
  daemon**: `nohup flowai-workflow run <workflow> … &`, then it greps the run-id
  from the log and polls via MCP read tools
  (`plugin-src/shared/agents/supervisor.md:35-90,124-152`). This is a deliberate
  "engine run = daemon, not a blocking call" decision.
- CLI start path: `runEngine` (`src/cli.ts:439`) builds `new Engine(options)`
  (`resume:false`) and blocks until `engine.run()` returns; `--prompt` sets
  `args.prompt` (`src/cli.ts:275-276`).
- Shared command core `src/mcp/commands.ts` already centralises `resumeRun` as
  the single `Engine({resume:true})` site; a start method belongs beside it as
  the single `Engine({resume:false})` site so CLI and MCP cannot drift.

### Current State

- Run-id is allocated inside the engine when `options.run_id` is unset
  (`cli.ts:516` resume path requires an explicit id; fresh path lets the engine
  generate one).
- FR-E60: parallel `Engine.run()` calls in one process are NOT supported; the
  per-workflow run lock (`<workflowDir>/runs/.lock`) serialises runs.
- FR-E83 parent-death watchdog kills the MCP server (and would kill anything it
  spawned in-process) when the host dies non-gracefully.
- FR-E73 acceptance asserts the server advertises **exactly eight** tools
  (`mcp-server_test.ts`); adding a tool changes that count contract.

### Constraints

- Engine stays domain-agnostic (no git/GitHub/PR awareness) — starting a generic
  run is allowed; nothing workflow-specific may leak in.
- No silent fallbacks/defaults (AGENTS.md): a start tool must fail clearly when a
  run is already live or the workflow is unresolved.
- Must reuse the `commands.ts` thin-delegate pattern; MCP/CLI stay thin.
- Must respect the per-workflow run lock and FR-E60 single-`Engine.run()`.
- Whatever blocking semantics is chosen must be documented in SRS+SDS (the SDS
  currently records the non-blocking model as deferred — that note must be
  updated to match reality).

## Definition of Done

- [x] (FR-E84) MCP exposes a start tool that begins a fresh run for the
      resolved workflow — Test: `src/mcp/mcp-server_test.ts` — Evidence: `deno task check`
- [x] (FR-E84) Start logic lives in `src/mcp/commands.ts` as the single
      `Engine({resume:false})` site, shared with CLI — Test: `src/mcp/commands_test.ts` — Evidence: `deno task check`
- [x] (FR-E84) Tool rejects starting when a run already holds the workflow lock
      (no parallel `Engine.run()`) — Test: `src/mcp/mcp-server_test.ts` — Evidence: `deno task check`
- [x] (FR-E84) FR-E73 tool-count acceptance + no-workflow tool list updated to
      the new count — Test: `src/mcp/mcp-server_test.ts` — Evidence: `deno task check`
- [x] SRS FR-E84 section added with `**Acceptance:**`; SDS §5 + tool list +
      §5.7 deferred note updated — Evidence: `deno publish --dry-run`
- [x] `deno task check` green — Evidence: `deno task check`

## Solution

Selected: **both modes** — one `start_run` tool with a `wait` control flag.
`wait:false` (default) = background detached daemon returning `run_id` immediately
(variant B, primary supervisor need); `wait:true` = in-process blocking run
returning final `RunState` (variant A). Consumer = `supervisor` agent.
`resume_node` is NOT touched. New FR-E84; FR-E73 tool count 8→9.

### Files

1. `src/state/lock.ts` — export `liveLockHolder(workflowDir): Promise<LockInfo |
   null>`: read `defaultLockPath`, return `info` iff PID alive, else `null`
   (reuse internal `isProcessAlive`; swallow NotFound/Syntax). Deterministic
   pre-check for background start.
2. `src/mcp/commands.ts` — add `startRun(params)`: the single
   `Engine({resume:false})` site, mirror of `resumeRun`.
   - `params`: `{ workflowDir, prompt?, wait?, verbosity? }`.
   - `wait === true`: `run_id = generateRunId(<workflow name>)`;
     `new Engine({ config_path, run_id, resume:false, dry_run:false,
     verbosity, args: prompt ? {prompt} : {}, env_overrides:{} })`;
     `await engine.run()`; return `{ run_id, status, total_cost_usd, wait:true }`.
   - `wait === false`: pre-check `liveLockHolder` → if non-null throw
     `"a run is already active (run_id: …); cannot start a parallel run"`;
     allocate `run_id = generateRunId(name)`; spawn detached engine subprocess
     (see Spawn below), `child.unref()`; return `{ run_id, pid, wait:false }`.
3. `src/cli.ts` — `parseArgs`: add `case "--run-id":` setting `runId` WITHOUT
   `resume=true` (distinct from `--resume`). Guard: `--run-id` + `--cycles>1`
   rejected (same reason as resume+cycles — explicit id collides across cycles).
   Document in CLI help + module header. Engine already honours
   `options.run_id` on the fresh path (`engine.ts:157`).
4. `src/mcp/mcp-server.ts` — `registerStartRun(server, workflowDir)`:
   schema `{ prompt: z.string().optional(), wait: z.boolean().default(false) }`;
   delegate to `commands.startRun`; add to the 8-registration list and to the
   `registerAllToolsNoWorkflow` `names` array (→ 9). Update module-header tool
   list + count prose.
5. Docs: SRS `documents/requirements-engine/07-mcp-and-plugin-runtime.md` — new
   `### 3.84 FR-E84` section (canonical field order; `**Acceptance:**` with
   `**Tests:**` line). Update FR-E73 acceptance "eight"→"nine" + tool list.
   SRS index `documents/requirements-engine.md` — add `FR-E84 (MCP start_run) →
   07-mcp-and-plugin-runtime` to the ID→section map. SDS
   `documents/design-engine/05-mcp-server.md` — add `registerStartRun` to §5.1
   list, a `start_run` bullet in §5.2, and DELETE the §5.7 "Non-blocking
   resume_node variant" deferred line (now realised for start). `commands.ts`
   module header — list `startRun`.

### Spawn (background, independent daemon — answer 3a)

Re-exec the engine, detached so it survives host/MCP-server death (FR-E83
watchdog only reaps the MCP server's own group, not an unref'd detached child):

- Command: `VERSION === "dev"` → `[Deno.execPath(), "run", "-A", "--no-check",
  <abs cli.ts via fromFileUrl(import.meta.resolve("../cli.ts"))>, "run",
  workflowDir, "--run-id", run_id, …prompt]`; else (compiled
  binary, `Deno.execPath()` IS the flowai-workflow binary) → `[Deno.execPath(),
  "run", workflowDir, "--run-id", run_id, …prompt]`. This env branch is explicit
  (not an error-recovery fallback) and commented.
- `prompt` → `["--prompt", prompt]` when present.
- `stdout`/`stderr` → `"null"` (daemon; observability is via run artifacts +
  `tail_artifacts`, not the parent pipe). `stdin: "null"`.
- `new Deno.Command(cmd, {args, stdout:"null", stderr:"null", stdin:"null"}).spawn()`,
  then `child.unref()`.

### TDD

- RED→GREEN `src/state/lock.ts`: `liveLockHolder` returns info for a live lock,
  `null` for absent/dead → `src/state/lock_test.ts` (or co-located).
- `src/mcp/commands_test.ts`:
  - `startRun wait:false` returns a non-empty `run_id` + `pid` without blocking
    (real detached spawn against the minimal `agent` workflow fixture; child
    fails fast on non-git tmp worktree — harmless; reap via `Deno.kill(pid)`).
  - `startRun wait:false` rejects when a live lock fixture is present (PID =
    `Deno.pid`); no spawn reached.
  - `startRun wait:true` surfaces the engine error on a broken/non-git workflow
    (mirror of the existing `resumeRun` nonexistent-run rejection) — proves the
    blocking `Engine({resume:false})` path.
- `src/cli.ts` parse: `parseArgs(["run","wf","--run-id","X"])` → `run_id:"X",
  resume:false`; `--run-id`+`--cycles 2` rejected → `cli_test.ts`.
- `src/mcp/mcp-server_test.ts`: update `length, 8`→`9` (both the all-tools test
  and the no-workflow test); add `start_run` to the expected-names set;
  `start_run` present in no-workflow mode and returns the missing-workflow error.

### Verification

`deno task check` (fmt+lint+full tests+slow-types) green; `deno publish
--dry-run` clean (FR-E84 JSDoc/section). No stray `deno.lock`/worktree artefacts
left by tests.

## Follow-ups (deferred)

- Rewire `supervisor` agent prose (`plugin-src/shared/agents/supervisor.md` +
  Codex `plugin-src/codex/.../supervisor/SKILL.md`) from `nohup flowai-workflow
  run …` to the `start_run` MCP tool. Deferred: spans Claude+Codex copies, no
  test harness, separable from the engine-surface change.
