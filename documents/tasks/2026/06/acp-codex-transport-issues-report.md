---
date: "2026-06-04"
status: in progress
implements: []
tags: [report, acp, codex, transport, reliability, diagnosis]
related_tasks:
  - 2026/06/acp-transport-config.md
  - 2026/06/stream-log-owned-by-engine.md
  - 2026/06/engine-warn-on-runtime-degraded-options.md
---

# ACP (codex) transport — problem report

**Type**: diagnostic report, NOT a plan. Captures observed failures, root
causes, and component-level scoping. Fix surface is enumerated as
follow-ups, not committed as a Solution.

## Status snapshot (as of 2026-06-04)

- P1 (`-32700` from codex-acp on heavy prompt) — **open**. Upstream,
  requires Open Question 1 to be answered before any fix is designed.
- P2 (`streamLogPath` silent drop on ACP) — **partially mitigated**.
  Engine now surfaces the library's `degradedOptions` warning for it
  via FR-E79 → operator sees `runtime onEvent: ... streamLogPath ...`
  WARN, but the file itself is still not written under
  `${node_dir}/stream.log` (library work in `acp-parity-closeouts.md`
  + engine-side ownership in `stream-log-owned-by-engine.md` still
  pending).
- P3 (`systemPrompt` inlined into `prompt[0].text`) — **engine-side
  diagnostic surface closed** by FR-E79
  ([engine-warn-on-runtime-degraded-options](engine-warn-on-runtime-degraded-options.md),
  pushed `3ab9154` / `ca02b02`). The library still inlines (no other
  channel exists on codex-acp ChatGPT-account flow), but the inlining
  is no longer silent — each invoke now emits a node-tagged WARN line
  before the wire send. Upper bound + fail-fast on prompt size still
  open (library side).
- P4 (engine retries `-32700` / `-32603` for 2 h) — **open**. No
  wall-clock cap on cumulative retry duration added in the engine yet;
  retry classification still owned by `ai-ide-cli`
  (`shouldRetry` + `runtime-error-analysis.ts`). A new engine FR
  for a cumulative wall-clock cap is a candidate follow-up but was
  deliberately deferred — see "What this report deliberately does not
  do".
- P5 (`resumeSessionId` / capability advertisements silent drops on
  ACP-codex) — **open**. All four gaps live in
  `ai-ide-cli/documents/tasks/2026/06/acp-parity-closeouts.md`
  (Gaps 1, 3, 4) plus FR-E79's WARN surface giving operators visibility
  into Gap 2 entries when they fire.

## Summary

After flipping `defaults.transport: acp` on the LumaTale `autonomous-sdlc`
workflow (project `/Users/korchasa/www/business/lumatale-fairy-taler`),
runs reliably fail on the largest-prompt node (`tech-lead-review`) with
`acp(codex): session/prompt → JSON-RPC error -32700: Parse error` and burn
~2 h on every node before giving up. Five distinct issues — three in
`@korchasa/ai-ide-cli` (ACP adapter), one in `@korchasa/flowai-workflow`
(engine retry/error-routing policy), one in `codex-acp@0.15.0` itself
(opaque upstream). The CLI transport (`codex exec`) did not exhibit any
of these because it speaks a different I/O shape and forwards
`system_prompt` separately.

## Evidence

Source of truth — workflow runs under
`.flowai-workflow/autonomous-sdlc/runs/`:

- Run `20260603T193151` — `tech-lead-review` node, single visible
  engine-attempt 18:11 → 20:09 (~2 h), final error
  `acp(codex): session/prompt → JSON-RPC error -32700: Parse error`,
  `error_category: cli_crash`. Earlier nodes (specification / design /
  decision / build / verify) all completed on the same `transport: acp`,
  same `model: gpt-5.5`.
- Run `20260602T232457` — `tech-lead-review` node, error
  `acp(codex): session/prompt → JSON-RPC error -32603: Internal error`,
  stderr tail
  `codex_acp::thread: Unhandled error during turn: {"type":"error",
  "status":400, "error":{"type":"invalid_request_error","message":"The
  'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT
  account."}}`. Same node, different model, same retry-storm shape.
- No `stream.log` exists under any `runs/<id>/<node>/` for ACP attempts;
  there is no wire-level record of what was sent or received.

Component versions at the time of the report:

- `@korchasa/ai-ide-cli` — `0.8.8` (jsr pin from `flowai-workflow/deno.json`).
- `@zed-industries/codex-acp` — `0.15.0` (pinned in
  `ai-ide-cli/runtime/acp/fronts.ts:48`).
- `@korchasa/flowai-workflow` — `dev` (local checkout).

## Architectural map

Three layers, two repo boundaries:

- **Workflow config** (`lumatale-fairy-taler/.flowai-workflow/autonomous-sdlc/workflow.yaml`)
  - Declares `transport: acp` in `defaults`. Per-node overrides absent for
    `tech-lead-review`. Sets `max_retries: 10`, `timeout_seconds: 1800`.
- **Engine** (`flowai-workflow/agent.ts`, `engine.ts`)
  - Forwards `transport` into `RuntimeInvokeOptions` (FR-E77).
  - Owns per-node retry / continuation policy and error categorisation
    (`error_category`). Does NOT consume `degradedOptions` callbacks.
  - Does NOT pass `streamLogPath` into ACP today (separate concern, tracked
    by `stream-log-owned-by-engine.md`).
- **Library** (`ai-ide-cli/runtime/acp/*`)
  - `adapter.ts:invokeViaAcp` — spawn `npx -y codex-acp@0.15.0`, do
    `initialize` / `session/new` / `session/set_mode` /
    `session/set_config_option` / `session/prompt`, drain notifications.
  - `client.ts:AcpStdioClient` — newline-delimited JSON-RPC over stdio,
    plain `JSON.stringify(envelope) + "\n"` writer.
  - `adapter.ts:shouldRetry` + `runtime-error-analysis.ts` —
    classification-driven retry decision.

## Problems

### P1 — `-32700 Parse error` from codex-acp on the largest prompt
- **Severity**: high — node fails, run fails.
- **Surface**: `ai-ide-cli/runtime/acp/adapter.ts:559` —
  `promptText = systemPrompt + "\n\n" + taskPrompt`, then
  `client.request("session/prompt", { sessionId, prompt: [{type:"text", text: promptText}] })`.
- **Why we don't know the root cause yet**: no `stream.log` on ACP path
  (see P2) → we cannot tell if codex-acp's serde_json rejects the line
  (size / encoding) or if codex-acp turned an upstream HTTP 4xx into
  `-32700` like it turned the 400 in run 20260602 into `-32603`. Native
  binary, no upstream source in cache.
- **Differentiator vs. passing nodes**:
  `agent-tech-lead-review.md` is 30 634 B vs. ~7–17 KB for others, all
  inlined into a single `prompt[0].text` because ACP has no separate
  system-prompt channel (see P3). Combined `prompt[0].text` for
  `tech-lead-review` is ~40 KB.
- **Repro**: spawn `npx -y @zed-industries/codex-acp@0.15.0`, run the
  standard handshake against a ChatGPT account, send `session/prompt`
  with the literal LumaTale `tech-lead-review` prompt body. Outside the
  scope of this report.

### P2 — `streamLogPath` is a silent drop on ACP transport
- **Severity**: high — blocks diagnosis of P1 and any future ACP wire
  issue.
- **Surface**: `ai-ide-cli/runtime/acp/mapping.ts:collectDegradedOptions`
  does not even mention `streamLogPath`; `runtime/acp/client.ts:#writeLine`
  / `#handleLine` have no log sink. CLI adapters (claude / codex / opencode
  / cursor `process.ts`) honor it.
- **Already tracked**: `ai-ide-cli/documents/tasks/2026/06/acp-parity-closeouts.md`
  Gap 2 (`streamLogPath` listed among missing degraded-options entries).
- **Symptom**: every ACP run in `lumatale-fairy-taler/.flowai-workflow/`
  has zero `stream.log` files.

### P3 — `systemPrompt` silently inlined into `prompt[0].text`
- **Severity**: medium — likely contributor to P1 but not exclusive.
- **Surface**: `ai-ide-cli/runtime/acp/adapter.ts:559`. Honest about it —
  `collectDegradedOptions` reports it via `onCallbackError` (`adapter.ts:88`),
  but the engine has no callback handler for that channel.
- **Impact**:
  - For codex (ChatGPT-account flow) ACP has no documented system-prompt
    transport; today's inlining is the only option.
  - But there is no upper bound and no fail-fast — a 30 KB system_prompt
    + 9 KB user_prompt go on the wire as a single ~40 KB JSON line that
    codex-acp may reject opaquely (P1).
  - Diagnostic noise leaks: large prompt → silent degradation → opaque
    `-32700`.

### P4 — Engine retries `-32700` / `-32603` for 2 hours
- **Severity**: high — turns a 30 s diagnosis into a 2 h black hole.
- **Surface**:
  - `ai-ide-cli/runtime/acp/adapter.ts:shouldRetry` (lines 356-372) —
    treats classified-as-`runtime_error` AND any unclassified `error` as
    retryable. `analyzeRuntimeErrorSignal` for `JSON-RPC error -32700:
    Parse error` produces no narrower kind, so the fallback retryable
    branch fires.
  - `lumatale-fairy-taler/.flowai-workflow/autonomous-sdlc/workflow.yaml:defaults` —
    `max_retries: 10`, `retry_delay_seconds: 5`, `timeout_seconds: 1800`.
- **Effect**: 10 attempts × per-attempt wait ≈ hours; the failure is
  deterministic (same prompt → same `-32700`) so retries cannot succeed.
- **Cross-cutting**: classification policy belongs to the library
  (`runtime-error-analysis.ts`); workflow-level retry budget belongs to
  the engine + workflow YAML. Both contribute.

### P5 — `resumeSessionId` / capability advertisements are silent drops on ACP-codex
- **Severity**: low for the current incident, but compounds P1's cost.
- **Surface**:
  - `ai-ide-cli/runtime/acp/adapter.ts:handshake` always calls
    `session/new`. `codex-acp@0.15.0` does not advertise
    `agentCapabilities.loadSession` (verified by content audit in
    `acp-parity-closeouts.md`), so every retry / engine continuation
    sends the full ~40 KB prompt again.
  - `onInit({runtime, sessionId})` does not include `model`
    (`adapter.ts:554`); `capabilityInventory: false` on ACP fronts.
- **Already tracked**: `ai-ide-cli/documents/tasks/2026/06/acp-parity-closeouts.md`
  Gaps 1, 3, 4.

## Non-issues (ruled out)

- **`model: gpt-5.5` invalid** — ruled out as cause of `-32700`. Same model
  succeeded on specification / design / decision / build / verify in the
  same run (run `20260603T193151`). Codex-acp accepts the configuration
  during `session/set_config_option`; failures would surface at handshake.
- **codex-acp connection / spawn issue** — ruled out. Handshake succeeds
  (5 nodes in the same run got a `session_id` back). Failure is
  strictly on the `session/prompt` round-trip of the heaviest node.
- **HITL / OS signal / lock contention** — no evidence in
  `runs/20260603T193151/journal.jsonl`; `attempt_started` → `node_failed`
  is the only gap, no HITL events, no lock messages.

## Scope by repo / module

- `ai-ide-cli/runtime/acp/`:
  - `adapter.ts` — `shouldRetry`, `attemptInvocation` (P3, P4).
  - `client.ts` — wire logging (P2).
  - `mapping.ts` — degraded-option diagnostic completeness (P2, P3, P5).
  - `runtime-error-analysis.ts` — RPC-code → kind classification (P4).
- `flowai-workflow`:
  - `agent.ts` — wire `degradedOptions` callback into engine event stream
    (P3 follow-up) — **done**, FR-E79 (commit `3ab9154`),
    [engine-warn-on-runtime-degraded-options](engine-warn-on-runtime-degraded-options.md).
    Pass `streamLogPath` to ACP (P2 follow-up — separate
    task already exists, [stream-log-owned-by-engine](stream-log-owned-by-engine.md)).
  - `engine.ts` — workflow-level cap on cumulative retry wall-clock for a
    single node, independent of per-attempt timeout (P4 belt-and-braces) —
    **open**.
- `codex-acp@0.15.0` (upstream, not editable): opaque `-32700` /
  `-32603` mapping for backend errors (P1 root). Out of our reach
  except by pinning a fixed version or downgrading transport for the
  affected nodes.

## Open questions (need empirical answers before designing a fix)

1. Is `-32700` a codex-acp parser failure on the JSON line (size /
   control char / surrogate pair), or is it codex-acp wrapping an upstream
   400/429 like it wrapped the 400 in run 20260602?
   - **How to answer**: live repro — `npx -y
     @zed-industries/codex-acp@0.15.0`, drive handshake, send a
     known-good small `session/prompt`, then send the literal
     `tech-lead-review` prompt body. Capture stderr + stdout. ~10 min.
2. Does codex-acp on ChatGPT-account have a documented body-size limit
   for `session/prompt`?
   - **How to answer**: bisect on prompt size — send 10 KB / 20 KB / 30 KB
     / 40 KB / 60 KB to find the threshold.
3. Does any ACP front (claude-agent-acp, opencode acp) suffer the same
   class of failure on equivalently large prompts?
   - **How to answer**: rerun LumaTale workflow with `transport: acp` and
     `runtime: claude` for `tech-lead-review` only.

## Cross-references

- `ai-ide-cli/documents/tasks/2026/06/acp-parity-closeouts.md` — Gaps 1
  (resume), 2 (degraded-options completeness incl. `streamLogPath`), 3
  (`onInit.model`), 4 (`capabilityInventory`). Status `to do`.
- `flowai-workflow/documents/tasks/2026/06/stream-log-owned-by-engine.md`
  — engine-side `stream.log` ownership; touches P2 from the consumer
  side.
- `flowai-workflow/documents/tasks/2026/06/acp-transport-config.md` —
  FR-E77, the change that flipped LumaTale onto ACP and exposed this.
- `ai-ide-cli/runtime/acp/adapter.ts:559` (`promptText` build),
  `:356` (`shouldRetry`), `:554` (`onInit`).
- `ai-ide-cli/runtime/acp/client.ts:373` (`#writeLine`), `:420`
  (`#handleLine`).

## What this report deliberately does not do

- Propose a single fix plan. Fix surface spans two repos and depends on
  the answer to Open Question 1 — designing without it risks
  papering over the symptom.
- Touch any code or config. Diagnosis only.
- Change classification policy for `-32603` / `-32700` retroactively.
  That requires a deliberate decision because some `-32603`s ARE
  transient (rate-limit wrapped by codex-acp).
