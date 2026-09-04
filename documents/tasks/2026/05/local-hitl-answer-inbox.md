---
date: "2026-05-31"
status: done
implements:
  - FR-E75  # new: Local HITL Answer Channel + unified command layer
---
# Local HITL Answer Channel (inbox file) + Unified Command Layer

## Goal

Let a human deliver a HITL reply to a waiting run **locally**, from the
interface they are already in (host IDE via MCP, or terminal via CLI),
without impersonating them on the workflow's remote transport (Telegram).

Today the engine reads a HITL reply ONLY from `check_script` stdout
(`hitl.ts:215-217`). When a workflow's `check_script` polls Telegram, a
choice made in Claude Code never reaches the live engine — the run hangs
healthy-but-blocked. We add a transport-independent local answer channel
and expose it through two THIN interfaces (MCP tool + CLI subcommand)
over ONE shared core command.

## Overview

### Context

- HITL is engine-owned via an MCP server the agent calls
  (`request_human_input`, FR-E8); question delivery + reply polling are
  delegated to workflow scripts `ask_script`/`check_script` — engine is
  transport-agnostic by design (`hitl-via-engine-mcp.md`).
- The poll loop `runHitlLoop` (`hitl.ts:192-283`) sleeps `poll_interval`,
  runs `check_script`, and on `exitCode===0 && stdout.trim()` treats stdout
  as the reply, appends the FR-E64 audit record, and resumes the agent
  session in-process (`hitl.ts:217-269`). The reply is consumed by the
  LIVE engine process that holds the runtime session — a separate process
  cannot resume that session itself.
- The embedded MCP server (FR-E73, `mcp-server.ts`) exposes 7 run-control
  tools. `resume_node` (`mcp-server.ts:290-318`) re-builds `new Engine({
  resume:true})` and runs; it does NOT carry an answer — it relies on
  `check_script` finding one. This same `Engine({resume})` construction is
  duplicated in `cli.ts` `runEngine` (`cli.ts:348-357`). Two parallel
  implementations of one operation.
- Path-consistency (verified): `hitl-handler.ts:139` passes
  `runDir = resolve(getRunDir(state.run_id, workflowDir))` — the ABSOLUTE
  project-root run dir, NOT the worktree — into `runHitlLoop`. An external
  writer (MCP/CLI) computes the identical anchor via
  `getRunDir(runId, workflowDir)` (`state.ts:117`). Anchoring the inbox at
  run-dir level (not the phased node-dir) makes reader and writer agree
  with zero worktree/`PhaseRegistry` coupling.
- Liveness: `lock.ts` holds `<workflowDir>/runs/.lock` (PID + run_id).
  `readLockInfo` is exported; `isProcessAlive` is private (`lock.ts:28`).

### Current State

- `hitl.ts` — single reply source (`check_script` stdout). No local source.
- `mcp-server.ts` — 7 tools; `resume_node` builds Engine inline; no
  answer-delivery tool. No-workflow tool-name list at
  `mcp-server.ts:150-168`.
- `cli.ts` — subcommands `run`, `init`, `mcp`; no `answer`. Resume path
  builds Engine inline in `runEngine`.
- `state.ts` — path helpers `getRunDir`/`getNodeDir`; no inbox helper.
- `.flowai-workflow/autonomous-sdlc/workflow.yaml` — HITL intentionally
  disabled (local-only). `github-inbox` uses Telegram scripts.

### Constraints

- Engine stays domain/transport-agnostic: inbox is a **local file**, not a
  transport. No Telegram/GitHub/Slack knowledge added to engine.
- No silent fallbacks (AGENTS rule): `answer` requires explicit
  `--node`; missing/non-waiting node → clear error, not a guess.
- TDD: RED→GREEN→REFACTOR→CHECK. No stubs/mocks for internal code.
- Atomic file write (tmp→rename) so the live poll loop never reads a
  half-written inbox file.
- Worktree base ref: code change affects only NEW/restarted runs. The
  currently-stuck live process runs old code — out of scope to unblock via
  this change (documented below).
- Deno only; `deno task` wrappers; keep `deno task check` green.

### Decisions (locked with user)

- `answer` semantics for a dead engine: **write inbox + report status**
  (`{inboxPath, live}`). NO auto-resume; caller resumes separately. Both
  MCP and CLI wrappers behave identically and never block.
- Target node: **explicit `--node` always**. No "single waiting node"
  auto-pick.
- Refactor scope: introduce `commands.ts`; move BOTH new `deliverHumanAnswer`
  AND existing resume into it; `mcp-server.ts` + `cli.ts` delegate.

## Definition of Done

- [x] FR-E75 added to SRS (`requirements-engine/04-runtime-and-hooks.md`),
      cross-refs FR-E8/FR-E64/FR-E73; index updated.
- [x] SDS updated (`design-engine/*`): command layer + inbox channel + flow.
- [x] `getHitlInboxPath` in `state.ts`, used by BOTH reader (`hitl.ts`) and
      writer (`commands.ts`). **As-built:** signature is
      `getHitlInboxPath(runDir, nodeId)` (run-dir anchor) rather than the
      planned `(runId, nodeId, workflowDir)` — the live reader holds
      `runDir`, not `workflowDir`; writer composes
      `getHitlInboxPath(getRunDir(runId, workflowDir), nodeId)`. Same
      resolved path; one shared helper.
- [x] `runHitlLoop` checks inbox BEFORE `check_script` each iteration;
      on hit: read → atomically consume (delete) → same audit+resume path
      (extracted `resumeWithReply`); inbox wins over `check_script`.
- [x] `commands.ts` exports `deliverHumanAnswer({workflowDir,runId,nodeId,
      text})→{inboxPath,live}` (validates node is `waiting`, atomic write,
      liveness via lock) and `resumeRun({workflowDir,runId,verbosity?})→
      {run_id,status,total_cost_usd}`.
- [x] MCP tool `provide_human_input` registered; `resume_node` refactored
      to call `commands.resumeRun`; no-workflow tool list includes the new
      tool; tool count updated in docstrings/FR-E73 (7→8).
- [x] CLI `answer <workflow> <run-id> --node <id> "<text>"` added; `run
      --resume` delegates to `commands.resumeRun`; `--help` updated.
- [x] Tests (FR-E75; regression-locked): inbox pickup+resume, consume-on-
      pickup (no self-answer next round), inbox-wins-over-check precedence,
      `deliverHumanAnswer` waiting-validation + atomic write + liveness,
      resume parity (MCP vs CLI same core).
- [x] `deno task check` green (incl. `deno publish --dry-run` slow-types).
- [x] Plugin surface: docs that enumerate MCP tools updated (FR-E73 SRS,
      `ideas.md`); payload rebuild verified — `commands.ts` bundled
      (`deno task sync-plugins -- --dry-run`, 164 files).

## Solution

### Data model / paths

- Inbox file: `<runDir>/.hitl-inbox/<nodeId>.txt`, content = reply text
  verbatim (mirrors `check_script` stdout contract). `<runDir>` =
  `getRunDir(runId, workflowDir)` (project-root, gitignored under
  `runs/**`). Run-dir anchor (not phased node-dir) → no `PhaseRegistry` in
  writer.
- Atomic write: write `<...>.txt.tmp` in same dir → `Deno.rename`.
- Consume: reader `Deno.remove` after read; absence = answered.

### Step 1 — SRS (RED-less doc step, do first per docs workflow)

Add FR-E75 to `requirements-engine/04-runtime-and-hooks.md` after FR-E8/
FR-E64. Canonical field order. Description subsections: (a) local inbox
file path + content contract; (b) reader precedence (inbox before
`check_script`, consume-on-pickup); (c) `answer` command contract
(explicit node, write-only, `{inboxPath,live}`); (d) two thin interfaces
(MCP `provide_human_input`, CLI `answer`) over one core. Update index
`requirements-engine.md` FR-E75 → 04-runtime-and-hooks. Note the unified
command layer (resume migration) as design in SDS.

### Step 2 — SDS

`design-engine/02-engine-modules-flow.md`: add `commands.ts` (run-control
core: `deliverHumanAnswer`, `resumeRun`); note MCP/CLI delegate. Extend
HITL flow in `design-engine/04-data-and-logic.md` with the inbox branch.

### Step 3 — `state.ts` (TDD)

RED: test `getHitlInboxPath(runId,nodeId,workflowDir)` returns
`<workflowDir>/runs/<runId>/.hitl-inbox/<nodeId>.txt`. GREEN: implement
beside `getNodeDir`.

### Step 4 — `lock.ts`

Export liveness for the command layer: add
`export async function isRunLive(workflowDir, runId): Promise<boolean>`
(reads lock; `info.run_id===runId && isProcessAlive(info.pid)`; false on
NotFound). Reuse private `isProcessAlive`. Test FR-E75 alive/dead/mismatch.

### Step 5 — `hitl.ts` reader (TDD)

RED: drive `runHitlLoop` with an injected `scriptRunner` that always
exits 1 (no Telegram reply) but pre-place an inbox file via
`getHitlInboxPath` under the test `runDir`; assert the loop reads it,
deletes it, appends `hitl.jsonl`, and resumes (claudeRunner called with
`taskPrompt===inbox text`). Second RED: after pickup, a subsequent HITL
round in same session must NOT re-consume (file already deleted). Third
RED: when BOTH inbox file and `check_script` stdout present, inbox wins.
GREEN: in the `while` body (`hitl.ts:192`), right after the `deadline`
guard, before building `checkArgs`: read inbox (`getHitlInboxPath` under
`runDir`); if present, `reply = content.trim()`, `Deno.remove`, then run
the existing reply→resume block (extract `hitl.ts:218-269` into a local
`resumeWithReply(reply)` helper shared by inbox + check_script paths to
avoid duplication).

### Step 6 — `commands.ts` (TDD)

RED: `deliverHumanAnswer` on a run whose node is NOT `waiting` →
throws/clear error (replay journal via `replayRunJournal(getRunDir(...))`,
check `state.nodes[nodeId].status==="waiting"`). RED: happy path writes
inbox atomically (assert file content) and returns `live` from
`isRunLive`. RED: `resumeRun` builds `Engine({resume:true,run_id,
config_path:configPathOf(workflowDir),verbosity})` and returns the summary
triple — assert parity with what `resume_node` returned before. GREEN:
implement both; `resumeRun` is the single Engine-resume construction.

### Step 7 — `mcp-server.ts` (TDD via InMemoryTransport)

- Register `provide_human_input` { run_id, node_id, text } → call
  `commands.deliverHumanAnswer`; `ok({inboxPath,live})`.
- Refactor `registerResumeNode` to call `commands.resumeRun` (no inline
  Engine).
- Add `"provide_human_input"` to `registerAllToolsNoWorkflow` names
  (`mcp-server.ts:150-168`).
- Update module docstring + FR-E73 "seven tools"→"eight".
- Test: InMemoryTransport call delivers inbox; no-workflow mode returns
  sentinel.

### Step 8 — `cli.ts` (TDD)

- New subcommand `answer <workflow> <run-id> --node <id> "<text>"` →
  `commands.deliverHumanAnswer` → print `{inboxPath, live}`; on `live:false`
  print a hint to also run resume. Missing `--node`/run/non-waiting → exit
  non-zero with clear message.
- Route `run --resume` through `commands.resumeRun` (preserve env load,
  verbosity, update-check; resume already incompatible with `--cycles`,
  `cli.ts:305`).
- Update `printUsage` + module-doc subcommand list.

### Step 9 — Plugin surface + docs

- Grep `plugin-src/` skills/agents + `documents/` for MCP tool
  enumerations / "seven tools"; add `provide_human_input`.
- `AGENTS.md` MCP/HITL notes: mention local inbox channel + `answer`.
- `deno task sync-plugins -- --dry-run` to confirm payload rebuild.

### Step 10 — CHECK

`deno task check` (fmt+lint+test+slow-types). Fix until green. Re-run full
suite, not just touched tests.

### Out of scope / follow-ups

- Unblocking the CURRENTLY stuck live process (old code, no inbox check):
  not fixable by this change. Options for that run only: human sends reply
  in Telegram, OR (post-merge) `cancel_run` → write inbox → resume.
- Host-IDE UX (skill auto-detects waiting node via `get_state`, prompts
  user, calls `provide_human_input`): separate task, builds on FR-E75.
- Bundled file-based `ask_script`/`check_script` "local HITL profile":
  separate, orthogonal to the engine inbox.
