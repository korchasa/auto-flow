---
date: 2026-06-02
slug: fr-e43-runtime-fallback
status: to do
implements:
  - FR-E43
---
# FR-E43 — Runtime Fallback (`defaults.fallback`)

## Goal

Allow a workflow to declare a secondary runtime that the engine
auto-switches to when the primary runtime invocation fails with a
classifiable overload / quota / availability error (e.g. `claude` →
`codex`). Increases run survivability when the primary provider is
degraded without operator intervention.

## Overview

### Context

- SRS: `documents/requirements-engine/02-nodes-and-models.md:212`
  (FR-E43, re-scoped 2026-06-02 from per-model fallback to whole-
  runtime fallback). Status currently "Implementation deferred".
- Failure taxonomy used by the trigger: `RuntimeInvokeResult.error_category`
  (FR-L36) — categories `overloaded`, `rate_limit`, `quota_exhausted`,
  `provider_unavailable` are the initial reasonable set. FR-E43 only
  consumes the existing taxonomy; it does NOT introduce new categories.
- Adapter registry: `@korchasa/ai-ide-cli` exposes one
  `RuntimeAdapter` per runtime ID via `getRuntimeAdapter(id)`
  (sibling repo `runtime/index.ts:93+`). Selection today is single-
  shot — chosen once via `resolveRuntimeConfig`.
- Engine wiring point: `node-dispatch.ts:128-176, 262-269` invokes
  `runAgent` once with the resolved primary runtime. FR-E43 turns
  that into a two-attempt pipeline (primary → optional fallback).
- Boundary precedent: `applyBudgetFlags` (`agent.ts:160-168`) shows
  the pattern for runtime-specific behaviour that lives in the engine
  (not the library). FR-E43 is broader — it picks an entirely
  different adapter, not just a flag.

### Current State

- `WorkflowDefaults` in `types.ts:117-145` declares `runtime`,
  `model`, `effort`, `runtime_args`, `transport`, `permission_mode`,
  `budget`, but no `fallback`.
- Config validation in `config.ts:220-294` validates each `defaults.*`
  scalar but has no slot for a structured `fallback` block.
- `resolveRuntimeConfig` (library, `runtime/index.ts:132-160`)
  resolves a single runtime triplet (runtime/model/effort/...) with
  node → parent → defaults cascade. No notion of an alternate
  runtime.
- Sessions are runtime-scoped: `--resume <session_id>` is meaningful
  only inside the runtime that produced the session. Cross-runtime
  resume cannot be supported; the fallback invocation is always a
  fresh session.
- `agent.ts:runAgent` runs ONE adapter for the whole continuation
  loop. To wire FR-E43, either (a) wrap `runAgent` in an outer
  retry-with-different-adapter loop, or (b) push the failover into
  `runAgent` itself.

### Constraints

- Single attempt only — no chained / oscillating fallbacks. If the
  fallback also fails with a category in `fallback.on`, the node
  fails through FR-E34 (`on_error` vs `on_failure_script`)
  precedence.
- Fallback fires only on the INITIAL invocation. Continuation
  (`--resume`) and post-`on_failure_script` re-runs stay on
  whichever runtime answered first — the run is no longer
  consulting the fallback policy.
- Workflow-level only (`WorkflowDefaults`). Per-node `runtime`
  override silently disables fallback for that node (only nodes
  using `defaults.runtime` are eligible).
- `fallback.runtime` MUST differ from `defaults.runtime`; config
  validation rejects equality at load time.
- `fallback.on` defaults to `["overloaded", "rate_limit",
  "quota_exhausted", "provider_unavailable"]`. Unknown category
  names rejected at config load with the supported-list error.
- HITL, MCP servers, allowed/disallowed tools, system prompt,
  permission mode, budget, cwd: reused verbatim from the primary
  node config. Model / effort / runtime_args / transport come from
  `fallback.*` if set; otherwise from the resolved primary config
  (engine warns when the primary `model` is not understood by the
  fallback adapter).
- Out of scope (future FRs):
  - chained fallbacks (`fallback.fallback`);
  - per-node `fallback` override;
  - adaptive policies (sticky-fallback for the rest of the run,
    time windows, breaker patterns);
  - cost / latency-based fallback (only error-category triggers).

## Definition of Done

- [ ] FR-E43 — `WorkflowDefaults.fallback?: FallbackConfig` added to
  `types.ts`; `FallbackConfig` has `runtime` (required),
  `model?`/`effort?`/`runtime_args?`/`transport?`/`on?`. Evidence:
  type compiles in `deno task check`.
- [ ] FR-E43 — Config validation rejects:
  (a) `fallback.runtime` missing,
  (b) `fallback.runtime === defaults.runtime`,
  (c) unknown category names in `fallback.on`,
  (d) `fallback` block when no `defaults.runtime` declared,
  (e) per-node `fallback` field.
  Tests: `config_fallback_runtime_test.ts` (FR-E43;
  regression-locked).
- [ ] FR-E43 — Engine dispatch path runs ONE additional invocation
  with the fallback adapter when the primary returns an
  `error_category` in `fallback.on`. The HITL question / scope-
  check / validation pipelines run on whichever adapter answered.
  Tests: `agent_runtime_fallback_test.ts` (FR-E43;
  regression-locked).
- [ ] FR-E43 — Fallback is skipped on continuations (`--resume`)
  and on re-runs triggered by `on_failure_script`. Tests:
  `agent_runtime_fallback_test.ts` (FR-E43; regression-locked).
- [ ] FR-E43 — Engine warns when `fallback.model` is unset AND the
  primary `model` is not understood by the fallback adapter (e.g.
  primary `claude-opus-4-6` → `codex` adapter). Warning surface:
  `OutputManager.warn(...)`. Tests: same file as above.
- [ ] FR-E43 — SRS acceptance block in
  `documents/requirements-engine/02-nodes-and-models.md` collapsed
  to the `**Tests:**` regression-locked line per
  dod-test-coverage-convention; `Status` field removed once
  implementation lands.
- [ ] FR-E43 — `documents/index.md` row updated from placeholder
  to `[x]` with anchor to the live SRS section.
- [ ] FR-E43 — SDS `documents/design-engine/03-subsystems.md` (node
  dispatch subsection) and `documents/design-engine/04-data-and-logic.md`
  (model / runtime resolution section) gain a short paragraph on
  the fallback decision path + the no-resume / no-oscillation
  invariants.

## Variants (selected: A — engine-side wrapper)

Decision 2026-06-02 (operator instruction "реализовывать будем на
уровне flowai-workflow"): the fallback policy stays an engine
concern. Library `@korchasa/ai-ide-cli` is NOT touched in this task.
Rationale: failover decision needs the workflow YAML
(`defaults.fallback`), workflow-level error policy (FR-E34), and
`OutputManager` for warnings — all engine surfaces. Pushing it
into the library would mix transport plumbing with workflow policy,
the very boundary the project has been clarifying (see
[isolation-provider](isolation-provider.md),
[budget-cli-runtime-coupling](budget-cli-runtime-coupling.md)).

### Variant A — Engine-side wrapper (selected)

- Engine wraps `runAgent` in a new `runAgentWithFallback`. If the
  first call returns `RuntimeInvokeResult.error_category ∈
  fallback.on`, it re-resolves the runtime adapter from
  `fallback.runtime` and re-invokes once. Library untouched.
- **Pros:** zero coordination with `@korchasa/ai-ide-cli`; the
  fallback policy is a pure engine concern; ships in one repo.
- **Cons / accepted risk:** the engine reads `error_category` from
  `RuntimeInvokeResult` directly — every new fallback-eligible
  category must be added to the engine allow-list AND to FR-L36 in
  lockstep. Drift between adapters classifying the same upstream
  error differently is on the engine to detect (and is in scope for
  the `OutputManager.warn` surface in DoD).

### Variant B — Library-level fallback contract (rejected)

- Library would gain `RuntimeInvokeOptions.fallback?:
  { adapter, options, on }`. Rejected: cross-repo coordination +
  JSR republish + boundary slip (library would own workflow
  policy).

### Variant C — Adapter-side native fallback (rejected)

- Use provider-native knobs (e.g. Claude `--fallback-model`).
  Rejected: scope mismatch — we want CROSS-runtime fallback
  (`claude` → `codex`), which no single provider offers. This was
  the original FR-E43 shape before the 2026-06-02 re-scoping.

## Open Questions

- How do we surface "fallback fired" in `state.json` and the run
  summary? Proposal: extend `NodeState` with `runtime_used: string`
  and `fallback_fired?: { primary, fallback, category }`.
- Does `cost_aggregate` (FR-E17) need a per-runtime breakdown when
  fallback fires? Probably yes — primary attempt incurs cost up to
  the failure, fallback attempt incurs its own cost.
- Should `fallback.on` default to ALL FR-L36 categories that map to
  upstream-provider unavailability, or just the four listed in the
  SRS? Conservative default = four; broader default risks masking
  bugs as "overload".

## Solution (Variant A — engine-side wrapper)

### Files to create

- `fallback.ts` (new module) — owns the fallback contract:
  - `interface FallbackConfig` (mirrors the SRS schema:
    `runtime` required; `model?`, `effort?`, `runtime_args?`,
    `transport?`, `on?: RuntimeErrorCategory[]`).
  - `DEFAULT_FALLBACK_CATEGORIES: readonly RuntimeErrorCategory[]`
    = `["overloaded", "rate_limit", "quota_exhausted",
    "provider_unavailable"]`. Sourced from FR-L36 — if the library
    later splits/renames these, the engine fails the lint loud.
  - `shouldFallback(result: AgentResult, fb: FallbackConfig): boolean`
    — returns `true` when `result.success === false`, `result.continuations === 0` (initial-only),
    and `result.error_category` is in `fb.on ?? DEFAULT_FALLBACK_CATEGORIES`.
  - `runAgentWithFallback(primary: AgentRunOptions, fb: FallbackConfig | undefined): Promise<AgentResult>`
    — calls `runAgent(primary)`. If `shouldFallback`, builds a
    secondary `AgentRunOptions` from `primary` overriding
    `runtime`/`model`/`reasoningEffort`/`runtimeArgs`/`transport`
    from `fb.*` (falling back to `primary.*` where `fb.*` is unset)
    and calls `runAgent(secondary)` ONCE. Returns the second
    result; emits `OutputManager.warn` describing the swap and any
    `model` carry-over warning.
- `config_fallback_runtime_test.ts` — validation tests (5 cases
  enumerated in DoD).
- `agent_runtime_fallback_test.ts` — dispatch tests (fires on
  category match; skipped on continuation; warns on incompatible
  model; single-attempt invariant).
- `fallback_test.ts` — pure-function tests for `shouldFallback`.

### Files to modify

1. **`types.ts`**
   - Import `RuntimeErrorCategory` from
     `@korchasa/ai-ide-cli/runtime`.
   - Add `FallbackConfig` interface (re-exported for downstream
     consumers).
   - Add `fallback?: FallbackConfig` to `WorkflowDefaults` (after
     `model`/`effort` so adjacent fields stay grouped).
   - Do NOT add `fallback` to `NodeConfig`. Per-node `fallback` is
     rejected at validation time (DoD criterion (e)).

2. **`config.ts`**
   - In the `defaults` validation block (`config.ts:220-294`),
     after `defaults.budget` validation, add a `validateFallback()`
     call that enforces:
     - (a) `fallback.runtime` is a non-empty string in
       `VALID_RUNTIME_IDS`,
     - (b) `fallback.runtime !== defaults.runtime`,
     - (c) `fallback.on` (when present) is a `RuntimeErrorCategory[]`
       intersected with `KNOWN_RUNTIME_ERROR_CATEGORIES` (engine
       allow-list mirrored from FR-L36),
     - (d) `defaults.runtime` is declared when `fallback` is
       present,
     - (e) a separate node-walk after the defaults block scans
       every `node.*.fallback` and rejects with the
       "fallback is workflow-level only" error.
   - Error texts (single source of truth) live as constants near
     the new helper to allow exact-match assertions in tests.

3. **`node-dispatch.ts`**
   - At the two `runAgent(...)` call sites (lines 128-176 and
     262-269), wrap each call in `runAgentWithFallback(opts,
     resolvedFallback)`. Compute `resolvedFallback` once per
     dispatch from `eng.config.defaults?.fallback` AND from
     `node.runtime === defaults.runtime` (per-node `runtime`
     override silently disables fallback for that node, per SRS).
   - Plumb `OutputManager` through to `runAgentWithFallback` so the
     "fallback fired" warning lands on the same surface as other
     node-scoped warnings.

4. **`state.ts` / `types.ts` (NodeState)** _(open question — see
   below)_
   - When fallback fires, persist `runtime_used` and
     `fallback_fired = { primary, fallback, category }` to
     `NodeState`. Renders in `OutputManager.summary` (FR-E15 /
     FR-E22 surfaces). DECIDE before TDD: skipping this means the
     fallback is invisible after the run; including it widens the
     state schema. Default position: include — debuggability
     outweighs schema cost. Revisit if reviewer pushes back.

5. **`documents/requirements-engine/02-nodes-and-models.md`**
   - Replace the current `**Status:**` block with a collapsed
     `**Tests:**` line per dod-test-coverage-convention. Drop the placeholder
     `Status` once tests are regression-locked.

6. **`documents/design-engine/03-subsystems.md`** + **`04-data-and-logic.md`**
   - 03-subsystems.md (node dispatch): add a short paragraph on
     `runAgentWithFallback` placement in the dispatch path.
   - 04-data-and-logic.md (model / runtime resolution): describe
     the no-resume / no-oscillation invariants.

7. **`documents/index.md`**
   - Flip the FR-E43 row from `[ ]` to `[x]` once tests land.

### TDD sequence

1. **RED**: write `fallback_test.ts::"FR-E43 shouldFallback returns true on initial overload error"` — fails because `fallback.ts` doesn't exist yet.
2. **GREEN**: create `fallback.ts` with `shouldFallback` minimal impl. Test passes.
3. **RED**: `fallback_test.ts::"FR-E43 shouldFallback returns false when continuations > 0"`.
4. **GREEN**: tighten predicate.
5. **RED**: `agent_runtime_fallback_test.ts::"FR-E43 runAgentWithFallback re-invokes with fallback runtime"` using two stub `RuntimeAdapter`s, the first returning `error_category: "overloaded"`. Fails — wrapper doesn't exist.
6. **GREEN**: implement `runAgentWithFallback`.
7. **RED**: `..."skips fallback on continuation"` — stub continues mid-validation. Fails.
8. **GREEN**: route continuation-driven re-invocations through the SAME adapter as the initial answer.
9. **RED**: `..."warns when primary model not understood by fallback adapter"` — stub adapter exposes a `supportsModel` capability check.
10. **GREEN**: implement warning surface.
11. **RED**: 5× `config_fallback_runtime_test.ts` cases (DoD criteria (a)-(e)). Each red individually before the matching validator branch is implemented.
12. **GREEN**: implement each branch in `validateFallback`.
13. **REFACTOR**: extract error-text constants; deduplicate stub-adapter helpers; collapse SRS acceptance block to `**Tests:**` line.
14. **CHECK**: `deno task check` exits 0; manually grep all four
    bundled workflows under `.flowai-workflow/*/workflow.yaml` to
    confirm none declared a stale `fallback_model` (none should —
    the field never landed in code).

### Verification commands

- `deno task check` — full pipeline (fmt, lint, tests, SRS lint).
- `deno test --filter "FR-E43" 2>&1 | tail -30` — fast iteration
  on just the FR-E43 tests.
- Manual smoke (optional): write a throwaway `workflow.yaml` with
  `defaults: { runtime: claude, fallback: { runtime: codex } }` and
  run `deno task run` with a stubbed Claude adapter that returns
  `error_category: "overloaded"`. Confirm the codex adapter receives
  the re-invocation. (Not part of CI — local dev aid.)

### Out of scope (re-confirmed)

- Chained fallbacks.
- Per-node `fallback`.
- Adaptive / sticky / time-window / breaker policies.
- Cost or latency-triggered fallback (error-category only).
- Library changes — no PR in `@korchasa/ai-ide-cli` for this task.
