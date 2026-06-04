---
date: "2026-06-04"
status: done
implements: [FR-E80]
tags: [engine, acp, codex, transport, retry, diagnosis, probe]
related_tasks:
  - 2026/06/acp-codex-transport-issues-report.md
  - 2026/06/acp-transport-config.md
  - 2026/06/stream-log-owned-by-engine.md
  - 2026/06/engine-warn-on-runtime-degraded-options.md
---
# ACP codex follow-ups — diagnostic probes + engine wall-clock retry cap

## Goal

Close the remaining engine-owned loop on the LumaTale ACP-codex transport
incident. Two outcomes:

1. Empirically answer Open Questions 1 and 3 from
   `acp-codex-transport-issues-report.md` so the next library-side fix
   (in `@korchasa/ai-ide-cli`) targets the right surface — parser failure
   vs. wrapped upstream HTTP error — instead of papering over the symptom.
2. Add an engine-level cumulative wall-clock cap per node (new FR-E80)
   so a deterministic-failure node fails in minutes instead of hours,
   independently of how the library classifies the error.

This delivers belt-and-braces: phase 1 (diagnostics) informs the library
fix surface; phase 2 (engine cap) bounds operator pain even when the
library and the upstream binary disagree on retry policy.

## Overview

### Context

- Source report: [acp-codex-transport-issues-report](acp-codex-transport-issues-report.md).
  P4 is the only open, engine-owned item; P1 is upstream (`codex-acp@0.15.0`),
  P2/P3/P5 are tracked in the library repo or already closed.
- Today the engine forwards `max_retries`, `retry_delay_seconds`, and
  `timeout_seconds` directly into the library's `RuntimeInvokeOptions`
  ([agent.ts:294-296](../../../agent.ts), [:436-438](../../../agent.ts)).
  The library owns the retry loop and the classifier
  (`@korchasa/ai-ide-cli/runtime/acp/adapter.ts:shouldRetry`,
  `runtime-error-analysis.ts`). Defaults: `max_retries: 3`,
  `retry_delay_seconds: 5`, `timeout_seconds: 1800`
  ([config.ts:41-44](../../../config.ts)).
- LumaTale `autonomous-sdlc` workflow.yaml sets `max_retries: 10`,
  `retry_delay_seconds: 5`, `timeout_seconds: 1800` — observed worst
  case ~2 h spent retrying the same deterministic failure
  (`runs/20260603T193151/tech-lead-review`).
- The library's retry classifier treats unclassified `JSON-RPC error
  -32700: Parse error` as retryable (`shouldRetry` fallback branch),
  so `max_retries: 10` × per-attempt timeout/wait dominates wall-clock
  cost.
- Open Question 1: is `-32700` a codex-acp parser failure (size /
  control char / surrogate pair) on the JSON line, or is it codex-acp
  wrapping an upstream HTTP 4xx/429 like it wrapped the 400 in run
  20260602? Live repro answers this in ~10 min.
- Open Question 3: does a different ACP front (claude-agent-acp) suffer
  the same class of failure on equivalently large prompts? Rerun
  LumaTale `tech-lead-review` with `runtime: claude` +
  `transport: acp`. Answers whether the gap is codex-acp-specific or
  ACP-wide.
- FR-E79 ([engine-warn-on-runtime-degraded-options](engine-warn-on-runtime-degraded-options.md))
  already surfaces library `onCallbackError` as visible WARN lines, so
  any silent-degradation signal during probes is now operator-visible
  (no engine change needed for diagnosis).

### Current State

- `runAgent` in [agent.ts](../../../agent.ts) calls
  `adapter.invoke(initialInvokeOptions)` once at line 306, then up to N
  `continuations` for validation failures. The LIBRARY's `adapter.invoke`
  internally retries spawn / RPC failures up to `maxRetries` with
  `retryDelaySeconds` between attempts; the engine does not wrap or
  bound that loop.
- No engine-level deadline / wall-clock budget on a single node's
  cumulative attempts. `timeout_seconds` bounds ONE attempt; nothing
  bounds the sum.
- Engine wires `transport` (FR-E77), `onCallbackError` (FR-E79) and
  per-node `effort` / `model` / `runtime` cascades. Settings field shape
  in [types.ts](../../../types.ts) (`NodeSettings`) is the natural home
  for a new cap field.
- No probe scripts exist for `codex-acp` direct interaction; today's
  only way to repro is via the full LumaTale workflow under
  `transport: acp`, which is slow and expensive.

### Constraints

- **Engine stays domain-agnostic.** The cap is a generic per-node wall-clock
  budget, not codex-acp-specific. Description and field name must reflect
  that — no `acp_` prefix, no transport-specific copy.
- **Backwards compatible.** Omitting the new field MUST keep existing
  workflows byte-identical. Default behaviour: no wall-clock cap (only
  the per-attempt `timeout_seconds` × `max_retries` upper bound that
  exists today). This avoids regressing slow-but-eventually-succeeding
  workflows.
- **Fail-fast when the cap is hit.** Engine aborts the in-flight invoke
  (subprocess kill via `ProcessRegistry`), records `error_category:
  cli_crash` (or a dedicated category — decided in Solution), and emits
  a WARN-level summary to the operator. No silent rollover into the
  next attempt.
- **TDD.** Every new behaviour lands as RED first, GREEN second; CHECK
  ends with full `deno task check` green.
- **No coupling to ACP.** The cap applies uniformly across transports
  (`cli`, `acp`) and runtimes (Claude, OpenCode, Codex, Cursor). It is
  enforced in `runAgent` around `adapter.invoke`, not inside any
  transport-specific branch.
- **Library boundary preserved.** Engine does NOT reach into the
  library's retry loop or classifier. Enforcement is an outer wrapper:
  AbortSignal / `Promise.race` / wall-clock budget pre-computed and
  passed in. No new library API required if the library already accepts
  an AbortSignal; if it does not, the engine wraps externally.
- **Probes are diagnostic only.** OQ1 / OQ3 scripts MUST NOT commit
  changes to project code, `.flowai-workflow/` configs, or any tracked
  artefact under `runs/`. Output goes to `documents/tasks/2026/06/`
  probe notes or a temp file referenced from chat.
- **Per-attempt `timeout_seconds` semantics unchanged.** The new cap is
  an UPPER BOUND on cumulative wall-clock; the existing per-attempt
  timeout still kills a single hung subprocess.
- **One AbortController per `runAgent` invocation, reused across all
  continuations.** The budget is the SUM of (library-internal retries
  + engine-level validation continuations). Creating a fresh controller
  per attempt would reset the clock and defeat the cap.
- **Resume semantics.** `flowai-workflow run --resume <id>` restarts
  the budget for each node it re-executes. The cap is per-`runAgent`-
  call wall-clock, not persisted in `state.json`. Operators get a
  fresh budget after manual intervention — matches existing
  `timeout_seconds` semantics.
- **HITL capture clears the timer.** When `onToolUseObserved` captures
  a question (run's terminal state per FR-L35 / hitl-via-engine-mcp),
  `runAgent` MUST clear the budget timer before the HITL early-return
  at `agent.ts:320-335`. Otherwise a long HITL-blocked period would
  incorrectly trip the budget while the user is typing an answer.

## Definition of Done

_(Filled with `(FR-ID, Test path, Evidence)` tuples after the user
picks a variant for the engine cap. Provisional list of locked
behaviours below — concrete test file paths land in `## Solution`.)_

- [x] **OQ1 probe** — driver `/tmp/oq1-probe.ts` (adapter-level repro
      via `getRuntimeAdapter("codex")` with `transport: acp`,
      `model: gpt-5.5`, sizes 10/25/40 KB). All sizes PASSED
      (wallMs 18125 / 14918 / 11578, ok=true). `-32700` NOT a pure
      size threshold; trigger narrowed to content-shape /
      session-length / upstream-wrap. Evidence:
      `acp-codex-transport-issues-report.md` "Empirical answers
      (2026-06-04 probes)" subsection under "Open questions".
- [x] **OQ3 probe** — driver `/tmp/oq3-probe.ts` (same payload,
      `getRuntimeAdapter("claude")` + `transport: acp` +
      `model: claude-sonnet-4-6`). Outcome (a) PASS — all three sizes
      ok=true (wallMs 12465 / 14339 / 9150). Gap not ACP-wide; no
      library FR warranted on this evidence. Evidence: same report
      subsection.
- [x] **FR-E80 schema** — `NodeSettings.max_retry_wall_clock_seconds?:
      number` typed and validated at config load. Reject ≤ 0 with the
      canonical diagnostic message. Evidence:
      `types.ts:283`, `config.ts::validateWallClockBudget`, tests at
      `config_test.ts::FR-E80 max_retry_wall_clock_seconds …`.
- [x] **FR-E80 enforcement** — `runAgent` enforces the cap around
      `adapter.invoke`, aborts the in-flight subprocess on expiry via a
      shared `AbortController`, surfaces a node-tagged WARN, returns
      `error_category: "retry_budget_exceeded"`. Evidence:
      `agent.ts::runAgent` (AbortController + try/finally), tests at
      `agent_runtime_test.ts::FR-E80 budget timer aborts …`,
      `FR-E80 controller reused across continuations`,
      `FR-E80 HITL capture clears the timer`.
- [x] **FR-E80 SRS** — FR-E80 section added to
      `documents/requirements-engine/05-cli-and-observability.md` (3.80)
      with the canonical FR field set; row registered in
      `documents/requirements-engine.md` map and `documents/index.md`.
      Evidence: `rg 'FR-E80' documents/requirements-engine.md
      documents/index.md` returns the new rows.
- [x] `deno task check` exits 0 (regression-locked by full suite).

## Solution

Variant C — AbortSignal pass-through. Engine creates an
`AbortController`, schedules a budget timer, and threads `signal` into
`adapter.invoke` on both initial and continuation calls. Library
honours the signal cooperatively (bails out of its retry loop, kills
its own subprocess, returns a typed failure). This is the only variant
that gives a single signal channel reusable for FR-E25 SIGINT
propagation, HITL-cancel, and a future MCP-driven external abort.

### Sequencing (three phases — run in order)

1. **Diagnostic probes (OQ1, OQ3).** No code change. Results recorded
   under `acp-codex-transport-issues-report.md` "Open questions"
   section. These do NOT block the engine cap landing — the cap is
   defensive regardless — but they may surface a complementary
   library-side fix (e.g. don't retry on `-32700` when the upstream
   answer indicates a deterministic parser-fail). Run them concurrently
   with the library-side AbortSignal work.
2. **Library precondition (`@korchasa/ai-ide-cli` sibling repo).** New
   FR (operator there picks the FR-L id; suggested slug
   `runtime-invoke-options-abort-signal`). The engine PR's `deno.json`
   floor bump and the library's release tag MUST land in the same
   engine commit — i.e. the engine PR is unmergeable until the
   library version it pins is on JSR. CI catches the mismatch via
   `deno cache --reload`. Surface:
   - `RuntimeInvokeOptions.signal?: AbortSignal` in
     `runtime/adapter-types.ts`.
   - ACP adapter (`runtime/acp/adapter.ts`): pass `signal` into the
     retry loop guard (between attempts), into
     `client.request("session/prompt", …, { signal })`, and into the
     subprocess spawn (`kill()` on abort).
   - CLI adapters (`claude/process.ts`, `opencode/process.ts`,
     `codex/process.ts`, `cursor/process.ts`): observe `signal` in their
     own retry/backoff loops; kill the spawned process on abort.
   - On signal-triggered abort, return a `RuntimeInvokeResult` with
     `error_category: "aborted"` and a clear `error` string ("aborted:
     wall-clock budget exceeded" or whatever string the engine passes
     as the abort reason), NOT a Node-only `AbortError` throw — engine
     consumers shouldn't need to catch the platform-specific error type.
   - Release a new minor version (engine bumps `deno.json` floor to
     match). The release MUST land before the engine PR is merged so
     a fresh clone never sees the engine call a not-yet-shipped library
     API.
3. **Engine FR-E80 implementation (this repo).** Details below.

### Files to create / modify (engine repo)

- [`types.ts`](../../../types.ts) — extend `NodeSettings`:
  ```ts
  /** Cumulative wall-clock budget for ALL invocation attempts of a single
   * node, in seconds (FR-E80). Bounds the engine's outer Promise.race
   * via AbortSignal forwarded to RuntimeInvokeOptions.signal. Undefined
   * means no cap — only per-attempt `timeout_seconds` applies. */
  max_retry_wall_clock_seconds?: number;
  ```
  Also extend the `ErrorCategory` union with
  `"retry_budget_exceeded"` (distinct from per-attempt `"timeout"`
  and global `"aborted"`; downstream agents and the dashboard can map
  it to a dedicated "ran out of retry budget" UX).
- [`config.ts`](../../../config.ts) — `DEFAULT_SETTINGS`:
  - Do NOT add `max_retry_wall_clock_seconds` to `DEFAULT_SETTINGS`.
    `undefined` IS the documented "no cap" state and avoids subtle
    "0 vs undefined" bugs. (Mirrors the `transport` precedent from
    FR-E77.)
  - In `validateSchema`, both `defaults` branch and per-node branch
    accept `max_retry_wall_clock_seconds`. Reject non-positive integers
    with `defaults.max_retry_wall_clock_seconds must be a positive
    integer (got '<x>')` and the analogous per-node message. Allow it
    to be omitted; allow it on either level.
- [`agent.ts`](../../../agent.ts) — inside `runAgent`:
  - Read `cap = settings.max_retry_wall_clock_seconds`.
  - When `cap !== undefined`:
    ```ts
    const budgetController = new AbortController();
    const budgetTimer = setTimeout(() => {
      budgetController.abort(
        new Error(`retry budget ${cap}s exceeded`),
      );
    }, cap * 1000);
    Deno.unrefTimer(budgetTimer);
    ```
    The engine is Deno-only by definition (`@korchasa/flowai-workflow`
    targets Deno via JSR), so `Deno.unrefTimer` is a hard dependency,
    not a feature-detected branch.
    `try` / `finally`: clear the timer on EVERY exit path (success,
    continuation-failure, validation-failure, HITL early return).
    Forgetting to clear leaks a 30-min timer per node — measurable
    drift over a long run.
  - Add `signal: budgetController?.signal` to BOTH
    `initialInvokeOptions` (around line 281-305) AND the resume call's
    `adapter.invoke({…})` (around line 411-435). Mirror the FR-E77 /
    FR-E79 pattern (single source, two call-sites).
  - After each `adapter.invoke()` return, check
    `budgetController?.signal.aborted`. When true, short-circuit to a
    failure `AgentResult` with `error_category:
    "retry_budget_exceeded"`, `error: "wall-clock budget Ns
    exceeded after K attempt(s)"`. Do NOT enter the continuation loop
    — once the budget is gone, retrying validation is pointless.
- [`node-dispatch.ts`](../../../node-dispatch.ts) — `executeAgentNode`:
  no signature change required (settings already flow through). One
  defensive assertion: when an `executeAgentNode` returns with
  `error_category === "retry_budget_exceeded"`, the journal
  `node_failed` event MUST carry the same category (existing forwarding
  pattern already covers this — verify with a focused test, see below).
- [`loop.ts`](../../../loop.ts) — when a body node returns
  `retry_budget_exceeded`, loop short-circuits to `error_category:
  "retry_budget_exceeded"` for the parent loop node (do NOT
  collapse to `"unknown"` like an unclassified failure).
- [`deno.json`](../../../deno.json) — bump
  `jsr:@korchasa/ai-ide-cli@^0.8.8` to the first version that ships
  `RuntimeInvokeOptions.signal`. Commit the updated `deno.lock` in the
  same change.
- [`documents/requirements-engine/05-cli-and-observability.md`](../../requirements-engine/05-cli-and-observability.md)
  — add `### 3.80 FR-E80: Cumulative Wall-Clock Retry Cap` section
  using the canonical FR field set: `Description`, `Motivation`
  (LumaTale 2h retry storm; cites
  `acp-codex-transport-issues-report.md`), `Dep`
  (`FR-E25` signal propagation; `FR-E77` transport agnostic),
  `Acceptance criteria` with a `**Tests:**` line.
- [`documents/requirements-engine.md`](../../requirements-engine.md) —
  insert `FR-E80 (Cumulative Wall-Clock Retry Cap) → 05-cli-and-observability`
  in the FR-ID → Section File map.
- [`documents/index.md`](../../index.md) — register the FR-E80 row
  under `## FR` (placeholder anchor `fr-e80-tbd` until the SRS section
  lands; commit phase fixes the anchor in one atomic edit).
- [`documents/design-engine/02-engine-modules-flow.md`](../../design-engine/02-engine-modules-flow.md)
  — append one paragraph + a line in the data-flow diagram showing
  `NodeSettings.max_retry_wall_clock_seconds → runAgent → AbortController
  → RuntimeInvokeOptions.signal → library retry loop`.

### Tests (TDD order — RED → GREEN → REFACTOR → CHECK)

1. `config_test.ts` — schema validation:
   - `FR-E80 max_retry_wall_clock_seconds accepted at defaults level`
     — `{ defaults: { max_retry_wall_clock_seconds: 600 } }` parses,
     resolved `settings.max_retry_wall_clock_seconds === 600`.
   - `FR-E80 max_retry_wall_clock_seconds accepted at node level` —
     per-node override resolves with node value winning.
   - `FR-E80 rejects non-positive integer` —
     `max_retry_wall_clock_seconds: 0` and `-1` raise the canonical
     diagnostic; `1.5` raises (must be integer); `"600"` (string)
     raises (must be number); the error message cites both the level
     and the offending value.
   - `FR-E80 omission stays undefined` — `settings.max_retry_wall_clock_seconds
     === undefined` when no field is set; no implicit default.
2. `agent_runtime_test.ts` — enforcement:
   - `FR-E80 budget timer aborts in-flight invoke` — fake adapter
     whose `invoke` awaits a promise that resolves only when the
     supplied `signal` is aborted, then returns a result with
     `error_category: "aborted"`. Drive `runAgent` with
     `max_retry_wall_clock_seconds: 1`. Assert (a) within ~1.5 s the
     `runAgent` resolves, (b)
     `result.error_category === "retry_budget_exceeded"`, (c)
     `OutputManager.warn` captured a node-tagged WARN line containing
     `wall-clock budget`, (d) the budget timer was cleared (use
     `Deno.metrics`-free check: assert no pending timer by spawning a
     second `runAgent` with cap and confirming no double-fire).
   - `FR-E80 no cap keeps behaviour unchanged` — omit
     `max_retry_wall_clock_seconds`; adapter returns success after
     50 ms. Assert no `signal` key forwarded to the adapter's options
     (use the existing `calls: RuntimeInvokeOptions[]` capture
     pattern) — confirms zero overhead path for the default case.
   - `FR-E80 controller reused across continuations` — cap set;
     validation fails twice, third attempt succeeds. Assert the SAME
     `AbortController.signal` instance is forwarded to all three
     `adapter.invoke` calls (capture and compare by identity using
     the existing `calls: RuntimeInvokeOptions[]` pattern). This locks
     the cumulative-budget contract.
   - `FR-E80 HITL capture clears the timer` — adapter invokes
     `onToolUseObserved` to capture a HITL question on a slow attempt
     (e.g., 500 ms after start). Cap set to 1 s. Assert `runAgent`
     returns the HITL early-return result, and within an additional
     2 s no abort-driven WARN fires.
3. `agent_test.ts` — error-category propagation:
   - `FR-E80 retry_budget_exceeded propagates` — drive
     `executeAgentNode` (via `engine_test.ts` helper or direct
     `node-dispatch.ts` call) with a fake adapter and capped settings;
     assert the journal `node_failed` event carries
     `error_category: "retry_budget_exceeded"`.
4. `loop_test.ts` (or `engine_test.ts` if no dedicated file):
   - `FR-E80 loop body budget exhaust propagates to loop node` — body
     node exceeds budget; loop node's `error_category` is
     `retry_budget_exceeded` (NOT `unknown`).

### Error-handling strategy

- **Cooperative abort.** Engine relies on the library honouring
  `signal`. If a future adapter ignores `signal` (regression), the
  engine's `setTimeout` fires but the library keeps running until
  `timeout_seconds` per attempt — operator sees a delayed but
  eventually-correct abort, not a hang. Adding a hard outer
  `Promise.race` as a safety net is deliberately out of scope (would
  re-introduce the Variant-A kill races C is meant to avoid); a
  library regression is caught by the regression test in step 4 of
  the library task.
- **Timer leak prevention.** EVERY exit path in `runAgent` (success,
  HITL early return, continuation exhaustion, validation pass,
  hook failure, cli_crash) MUST clear the budget timer via a
  `finally` block at the top of the function. Adding a single
  `using` disposer (TC39 Explicit Resource Management) once the
  Deno toolchain ships full `using` support would be cleaner; today
  prefer an explicit `try { … } finally { clearTimeout(budgetTimer) }`
  around the entire post-create body.
- **Signal vs HITL.** HITL (`onToolUseObserved` capturing the question)
  is the run's terminal state when triggered. If the wall-clock timer
  fires AFTER HITL has captured but BEFORE the engine reads it back,
  the captured question still surfaces (HITL early-return at
  `agent.ts:320-335` runs before any post-invoke budget check). Lock
  this ordering with a focused test in `agent_test.ts` —
  `FR-E80 HITL capture wins over expired budget`.
- **Process registry interaction.** Library kills its own subprocess
  on signal (per the library task). Engine's `ProcessRegistry`
  shutdown callback (FR-E25) remains the SIGINT/SIGTERM path and is
  not touched by FR-E80.

### Verification commands

- `deno task check` — full lint + type-check + test suite.
- `deno task test config_test.ts agent_runtime_test.ts agent_test.ts
  loop_test.ts` — focused per-file pass.
- `deno run -A --no-check cli.ts run .flowai-workflow/github-inbox
  --dry-run` AND the same for `.flowai-workflow/autonomous-sdlc` —
  smoke that dry-run on the dogfood workflows (which do NOT set the
  new field) renders byte-identically to a pre-change baseline. Capture
  diff once during develop; any diff fails the smoke.
- `rg 'FR-E80' documents/` — verify FR registration in SRS + index.
- `rg '@korchasa/ai-ide-cli' deno.json` — verify version-floor bump
  matches the library tag declared in the library task.

### Diagnostic-probe procedures (OQ1, OQ3)

OQ1 — codex-acp `-32700` repro. Run locally, NOT via the workflow:

```bash
# scratch dir outside the repo
cd /tmp
npx -y @zed-industries/codex-acp@0.15.0 < oq1-driver.jsonl > oq1.out 2> oq1.err &
```

`oq1-driver.jsonl` contains the canonical handshake +
`session/set_config_option` for the same model the LumaTale run used,
then `session/prompt` with the literal `tech-lead-review` prompt body
(copied from `agents/agent-tech-lead-review.md` + the synthesised
user prompt the workflow built). Capture three runs at increasing
prompt sizes (10 KB / 25 KB / 40 KB) to bisect any size threshold.
Append the result table to the report under "Open questions" — one
line per size: bytes / wall-clock / RPC error code / stderr last line.

OQ3 — Claude-front parity. In `lumatale-fairy-taler`, on a SCRATCH
branch with the workflow.yaml edit STASHED locally (do NOT commit and
do NOT push; the swap is a temporary probe, not a config change):

```bash
git switch -c probe/oq3-claude-acp-tech-lead-review
# In the workflow.yaml of autonomous-sdlc, swap:
#   defaults: { runtime: codex, transport: acp, model: gpt-5.5 }
# to:
#   defaults: { runtime: claude, transport: acp, model: claude-sonnet-4-6 }
# Run ONLY the tech-lead-review node (use the workflow's --resume
# semantics or a stub of upstream nodes).
flowai-workflow run .flowai-workflow/autonomous-sdlc
# After capturing the result, git switch back and discard the probe branch.
```

Outcome categories: (a) PASS — claude-front handles ~40 KB fine,
gap is codex-acp-specific; (b) FAIL with `-32700` — gap is ACP-wide,
file as library FR; (c) FAIL with a different error — separate
investigation thread. Record outcome + first failing turn's RPC
envelope.

### Out of scope (explicit)

- Engine-side classifier override for `-32700` (would couple engine to
  transport-specific knowledge; lives in `ai-ide-cli`).
- Hard outer `Promise.race` safety net (Variant A) — re-introduces
  the kill-race C is designed to avoid.
- Workflow-level cumulative budget across nodes (FR-E47 covers the
  cost axis; a wall-clock axis would be a separate FR).
- Codex-acp version bump or pin — upstream concern.

## Follow-ups

- Library FR (sibling repo `@korchasa/ai-ide-cli`):
  `runtime-invoke-options-abort-signal` — the precondition for this
  task. File before engine PR; engine cannot merge until the matching
  library release is on JSR.
- After OQ1 lands, decide library-side whether to classify `-32700`
  as non-retryable (engine inherits the improvement via the version
  floor bump done here).
- Once OQ3 lands, optionally file a sibling-repo ACP-front FR if the
  gap is ACP-wide.
- Future FR-E?: route `AbortController` for SIGINT propagation through
  the same `RuntimeInvokeOptions.signal` channel (refactor of FR-E25
  internals) — single signal source.
