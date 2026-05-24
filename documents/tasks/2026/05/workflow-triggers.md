---
date: "2026-05-22"
status: to do
implements: []
tags: [triggers, scheduling, polling, automation, embedding]
related_tasks:
  - 2026/05/engine-singleton-guard.md
  - 2026/05/phase-registry-per-run.md
  - 2026/05/signal-handler-boundary.md
  - 2026/05/durable-run-lifecycle-replay.md
  - 2026/05/node-lifecycle-callback.md
---

# Workflow Triggers — Periodic & Polling Invocation

## Goal

Allow flowai-workflow runs to fire automatically — by wall-clock schedule
(e.g. weekly repo cleanup) or by polling an external signal source (e.g.
prod-error backend for bug-hunt workflows) — without the operator typing
`flowai-workflow run …` each time. The mechanism must respect the
engine's domain-agnostic invariant (no git/GitHub/cron knowledge inside
the engine) and must not regress library-embedding contracts FR-E59,
FR-E60, FR-E61, FR-E68, FR-E69.

## Overview

### Context

- Repo-housekeeping workflows (delete stale branches, prune `runs/`,
  rotate memory snapshots, refresh dependency lockfiles) and
  prod-bug-discovery workflows (poll Sentry / GH issues / log query API
  for new errors and trigger an investigation pipeline) both need
  unattended execution.
- The current invocation surface is purely manual: `flowai-workflow run
  <workflow>` (one cycle) or `--cycles N` (sequential repeats inside one
  process). There is no clock-driven or signal-driven entry point.
- `scripts/self-runner.ts` (`deno task loop`) is the only existing
  background loop, but it (1) is hard-wired to `gh issue list` as the
  trigger source, (2) is hard-wired to the `.flowai-workflow/github-inbox`
  workflow, (3) lives in `scripts/` and is excluded from the JSR package,
  so library hosts cannot reuse it.
- The user expressed two concrete needs: periodic repo cleanup, and
  periodic prod bug hunting. Both fall outside the current explicit-call
  model.

### Current State

- **CLI entry (`cli.ts`)**: subcommands `run`, `init`, `hitl` (internal
  MCP); flags `--prompt`, `--resume`, `--dry-run`, `-v/-s/-q`, `--env`,
  `--skip`, `--only`, `--cycles N`, `--skip-update-check`. `--cycles`
  loops `Engine.run()` inside a single process, fail-fast on the first
  non-completed cycle. No clock, no source-polling.
- **`scripts/self-runner.ts` (`deno task loop`)**: long-running while-
  loop. Each iteration: `gh issue list --state open --json …` → filter
  out `in-progress` label → if matches: `parseArgs([".flowai-workflow/
  github-inbox"])` → `new Engine(options).run()`; if empty queue:
  `nextPause(pause)` exponential backoff (30 s … 4 h). Installs OS
  signal handlers. Hard-coded paths and provider (`gh`).
- **Library-embedding seams already in place**: per-run phase registry
  (FR-E59), caller-supplied `ProcessRegistry` (FR-E60), signal-handler
  boundary so `Engine` never touches SIGINT/SIGTERM (FR-E61), per-node
  `onNodeLifecycle` callback (FR-E68), append-only `journal.jsonl` for
  durable replay (FR-E69). Sequential `Engine.run()` from a host is
  explicitly supported; parallel runs in one process are not.
- **Engine safety guards relevant to scheduled cleanup**: FR-E50 (no
  uncommitted main-tree edits at run start), FR-E54 (per-workflow run
  lock at `<workflowDir>/runs/.lock`), worktree base ref pinned to
  `origin/<base>` — a cleanup workflow that wants to act on local
  changes must commit/push them itself.
- **Architectural invariant**: engine is domain-agnostic (FR-E14) and
  workflow-independent — it must not learn about git, GitHub, Sentry,
  cron expressions, or any specific signal source.

### Constraints

- **Engine purity**: any cron/polling/event mechanism living inside
  engine code is rejected by FR-E14 unless it is itself fully
  domain-agnostic (e.g. a generic timer abstraction with pluggable
  signal sources lives outside the engine).
- **Library embedding contract**: a chosen design must not require the
  engine to install signal handlers (FR-E61 boundary), must not leak a
  module-level state between runs (FR-E59), and must continue to
  honour caller-supplied `ProcessRegistry` (FR-E60).
- **No new module-level global singletons** in engine code (decision
  `engine-singleton-guard`).
- **Trigger-source plurality**: the user confirmed both *time-based
  (cron)* and *polling an external source* are in scope. Webhook /
  file-watcher triggers are explicitly out of scope for this task.
- **Repo state preconditions for cleanup workflows**: any
  cleanup-style trigger MUST own its own commit/push step inside the
  workflow YAML — engine continues to reject runs that start with
  uncommitted main-tree modifications.
- **Concurrency**: parallel `Engine.run()` in one process is unsupported;
  the planner / host MUST serialize fires per workflow (queue +
  per-workflow lock).
- **No webhooks / HTTP server in this iteration** (would need public
  endpoint, auth, secret rotation — separate task).
- **No file watcher** (local-only, narrower than the user's two
  motivating cases).

## Definition of Done

*(Placeholders — filled with FR-paired acceptance tuples after the user
selects a variant. Each line will gain `Test:`/`Evidence:` pointers per
FR-canonical-field-set and dod-test-coverage-convention.)*

- [ ] Time-based trigger source documented and runnable for at least
  one bundled workflow (cleanup or bug-hunt).
- [ ] Polling-based trigger source documented and runnable, with at
  least the existing `gh issue list` polling case migrated onto the
  new shape (no regression in `deno task loop` behaviour).
- [ ] Trigger mechanism honours per-workflow run lock (FR-E54): a fire
  while a previous run is still active is queued or skipped, never
  parallel.
- [ ] Trigger mechanism honours engine safety guards (FR-E50): if the
  triggered workflow needs to mutate the repo (cleanup), the workflow
  itself commits/pushes inside its DAG; the trigger surface does not
  do `git` directly.
- [ ] `scripts/self-runner.ts` either (a) survives as the canonical
  example with no semantic regression, or (b) is replaced by the new
  generic mechanism and `deno task loop` is rewired accordingly —
  one of the two is shipped, no broken intermediate state.
- [ ] AGENTS.md "Project Vision" / "Architecture" updated to mention
  the trigger surface and where it lives in the layering.
- [ ] Engine-scope FRs untouched OR new FR-E added (variant-dependent);
  if the chosen variant is purely outside the engine, the SRS-engine
  is NOT modified.

## Solution

*(Placeholder — filled after the user picks one of the variants
presented in chat. The detailed step list will name concrete files,
new modules, test paths, and `Evidence: <command>` lines per
acceptance criterion.)*

## Follow-ups

*(Filled by the critique step after variant selection.)*
