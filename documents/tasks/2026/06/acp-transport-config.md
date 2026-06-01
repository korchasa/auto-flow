---
date: "2026-06-02"
status: done
implements: [FR-E77]
tags: [engine, runtime, acp, transport, config]
related_tasks:
  - 2026/05/hitl-via-engine-mcp.md
  - 2026/05/budget-cli-runtime-coupling.md
  - 2026/05/hitl-detection-boundary.md
---
# ACP transport opt-in via workflow config

## Goal

Let workflow authors opt agent invocations into the Agent Client Protocol
(ACP) transport shipped by `@korchasa/ai-ide-cli` v0.8.8 by declaring
`transport: acp` in `workflow.yaml` (workflow defaults or per-node), without
touching engine internals or client glue. Today the library exposes
`RuntimeInvokeOptions.transport`, but the engine hard-codes the implicit
`"cli"` default — no project can switch transports without forking
`agent.ts`.

## Overview

### Context

- Library state — `@korchasa/ai-ide-cli@0.8.8` (`runtime/acp/*`) ships an
  opt-in ACP front for Claude / Codex / OpenCode (FR-L17/L19/L20/L23/L37/L39).
  Per-runtime `RuntimeAdapter.capabilitiesFor("acp")` exposes a transport-
  scoped capability vector that downgrades CLI-only features (`transcript`,
  `interactive`, `toolFilter`, `capabilityInventory`). HITL-relevant flags
  (`mcpInjection`, `toolUseObservation`, `session`, `reasoningEffort`,
  `permissionMode`) round-trip natively on Claude. Cursor remains
  `pilot: false` and throws at invocation when `transport === "acp"`.
- Engine state — `config.ts`, `node-dispatch.ts`, `loop.ts`, `hitl-handler.ts`
  call `resolveRuntimeConfig({ defaults, node, parent? })` and forward the
  resolved `runtime`, `args`, `permissionMode`, `model`, `reasoningEffort`
  into `runAgent → adapter.invoke()`. The `transport` field is never read or
  cascaded; `runAgent` builds `RuntimeInvokeOptions` without it, so every
  call lands on `"cli"`. `agent.ts:217` gates HITL MCP injection on
  `adapter.capabilities.mcpInjection`, not on the transport-scoped vector.
- User intent — projects (dogfood `.flowai-workflow/<wf>/workflow.yaml` and
  any third-party consumer) need a single declarative knob to switch
  transports per workflow or per node, with config-load validation that the
  picked transport is supported by the picked runtime.

### Current State

- `types.ts` defines `WorkflowDefaults` / `NodeConfig`. Neither carries a
  `transport` field. `runtime_args`, `model`, `permission_mode`, `effort`,
  `runtime` cascade through `resolveRuntimeConfig`.
- `config.ts:validateSchema` validates `defaults.runtime`, `runtime_args`,
  `permission_mode`, `effort`, `budget`, `hitl`. No transport recognition.
- `config.ts:validateRuntimeCompatibility` runs after merge to reject
  cross-runtime mismatches (e.g. non-`bypassPermissions` mode on
  OpenCode/Cursor). No transport compatibility check.
- `node-dispatch.ts:97` + `loop.ts:203` + `hitl-handler.ts` (resume path)
  call `resolveRuntimeConfig` and feed `runAgent` from the result. None
  thread a transport.
- `agent.ts:209-276` constructs `RuntimeInvokeOptions` and calls
  `adapter.invoke()` twice (initial + resume); both omit `transport`. The
  HITL gate at `agent.ts:217` reads `adapter.capabilities.mcpInjection`
  rather than `adapter.capabilitiesFor?.(transport) ?? adapter.capabilities`.
- The library exports `TransportOption = "cli" | "acp"` from
  `@korchasa/ai-ide-cli/runtime/types`, plus `capabilitiesFor(transport)` on
  every adapter. `resolveRuntimeConfig` does NOT cascade transport today —
  the engine must do its own three-level resolution mirroring `runtime`.
- Engine `deno.json` pins `@korchasa/ai-ide-cli@^0.8.7`. Caret pulls
  0.8.8 on the next `deno cache --reload`, but the floor MUST be bumped to
  `^0.8.8` so a fresh clone gets ACP-capable runtime by default.
- ACP downgrades `toolFilter` and `transcript` on Claude:
  `allowed_tools`/`disallowed_tools` become no-ops (already library-warned
  once per process); engine should NOT crash, but the workflow author must
  see a config-load warning when both are present so the silent downgrade
  is visible.

### Constraints

- Engine stays domain-agnostic — no ACP-specific behaviour in engine code
  beyond plumbing `transport` through cascade and capability gates.
- Backwards compatible — omitting `transport` keeps every existing workflow
  byte-identical. Default value is `"cli"` (matches library default).
- Fail-fast at config load when the selected `runtime` cannot serve the
  selected `transport` (today: `transport: acp` + `runtime: cursor`). No
  silent fallback.
- `runtime_args` reserved-keys logic, `allowed_tools`/`disallowed_tools`
  mutex, and `permission_mode` cascade rules are unchanged.
- HITL MCP injection guard MUST consult the transport-scoped capability
  vector (`capabilitiesFor(transport) ?? capabilities`) so that future
  ACP fronts that lack `mcpInjection` automatically skip HITL wiring
  instead of crashing at invocation time.
- Use existing types — `TransportOption` from
  `@korchasa/ai-ide-cli/runtime/types`. Do not coin an engine-local enum.
- TDD: every new behaviour landed as RED first, GREEN second; CHECK ends
  with full `deno task check` green.

## Definition of Done

(Tuple per item: FR-ID + Test|Benchmark|manual + Evidence command. To be
finalised in step 5a after variant selection — placeholder pending
solution-level file layout. Mandatory items below; per-criterion bullets
exercised by listed tests collapse to a `**Tests:**` line in the SRS per
the dod-test-coverage-convention.)

- [x] **FR-E77**: `WorkflowDefaults.transport` and `NodeConfig.transport`
      typed as `TransportOption`; cascade `node → loopParent → defaults`
      with `"cli"` fallback. Test: `runtime_test.ts::FR-E77 transport
      cascade`. Evidence: `deno task test runtime_test.ts`.
- [x] **FR-E77**: `config.ts:validateSchema` rejects unknown transport
      values with a clear error citing valid options. Test:
      `config_test.ts::FR-E77 invalid transport`. Evidence:
      `deno task test config_test.ts`.
- [x] **FR-E77**: `config.ts:validateRuntimeCompatibility` rejects
      `transport: acp` for runtimes whose adapter throws on `acp`
      (currently Cursor) at config-load time. Test:
      `config_test.ts::FR-E77 transport runtime mismatch`. Evidence:
      `deno task test config_test.ts`.
- [x] **FR-E77**: `agent.ts` threads resolved transport into
      `adapter.invoke()` on both initial and resume calls, and HITL MCP
      injection guard reads `adapter.capabilitiesFor?.(transport) ??
      adapter.capabilities`. Test: `agent_runtime_test.ts::FR-E77
      transport forwarded`, `agent_test.ts::FR-E77 hitl capability under
      transport`. Evidence: `deno task test agent_runtime_test.ts
      agent_test.ts`.
- [x] **FR-E77**: `--dry-run` surfaces effective transport per agent node
      (so operators see the switch before paying for a run). Test:
      `output_test.ts::FR-E77 dry-run transport`. Evidence:
      `deno task test output_test.ts`.
- [x] **FR-E77**: `deno.json` bumps `@korchasa/ai-ide-cli` floor to
      `^0.8.8` (first version with the stable ACP surface).
      Evidence: `rg '@korchasa/ai-ide-cli' deno.json`.
- [x] **FR-E77**: Add `FR-E77` section to
      `documents/requirements-engine/04-runtime-and-hooks.md` with the
      canonical FR field set; register in `requirements-engine.md` index
      and `documents/index.md`.
      Evidence: `rg 'FR-E77' documents/requirements-engine.md
      documents/index.md`.

## Solution

Variant A — strict cascade field with full config-load validation.
Mirrors the existing `runtime` / `runtime_args` / `model` cascade so
workflow authors get one consistent mental model.

### Pre-implementation verification

Before touching code, read
`@korchasa/ai-ide-cli@0.8.8`'s `runtime/codex-adapter.ts` and
`runtime/opencode-adapter.ts` and record what their
`capabilitiesFor("acp")` returns for `mcpInjection` and `toolFilter`.
If either downgrades `mcpInjection` to `false`, the FR-E77 warning copy
in `config.ts` MUST mention the affected runtime(s) by name so the
operator knows HITL will silently drop on the ACP path. Document the
result in the FR description; do not assume parity with Claude's
vector.

### Files to create / modify

- `types.ts` — add `transport?: TransportOption` to both `WorkflowDefaults`
  and `NodeConfig` (re-export `TransportOption` from
  `@korchasa/ai-ide-cli/runtime/types` next to the existing `ExtraArgsMap`
  re-export so engine consumers don't need a second import path).
- `config.ts`
  - Do NOT add `transport` to `DEFAULT_WORKFLOW_DEFAULTS`. `resolveTransport`
    owns the `"cli"` fallback; an explicit default would shadow the
    `undefined ≡ "cli"` library convention and risk subtle equality bugs
    in future compatibility checks (`defaults.transport === "cli"` vs
    `undefined`).
  - In `validateSchema` (`defaults` branch + per-node branch), validate
    `transport` is one of `"cli" | "acp"`. Reject any other value with
    `defaults.transport has invalid value '<x>'. Must be one of: cli, acp`
    (and the analogous per-node message).
  - Add `export function resolveTransport(node, defaults, parent?):
    TransportOption` next to `resolveToolFilter`. Precedence
    `node → parent → defaults → "cli"` (first level that declares wins;
    SCALAR REPLACE — `transport` is a scalar enum, not a per-key merge
    like `runtime_args`). Loop body cascade reuses `parent = loopNode`,
    matching `runtime_args`.
  - Extend `validateRuntimeCompatibility`: for every agent node whose
    resolved transport is `"acp"`, call
    `getRuntimeAdapter(runtimeConfig.runtime).capabilitiesFor?.("acp")`
    inside a `try`. If `capabilitiesFor` is undefined OR throws, raise
    `Node '<id>': runtime '<runtime>' does not support transport 'acp'`.
    This catches the Cursor case today and any future adapter that opts
    out of ACP.
  - Emit a one-shot warning when `transport === "acp"` AND the same level
    sets `allowed_tools` / `disallowed_tools`: `Node '<id>': allowed_tools/
    disallowed_tools is ignored under transport 'acp' (capabilitiesFor:
    toolFilter=false)`. Print via the `OutputManager` warning path — do
    NOT throw (library already warns once per process; this surfaces the
    silent downgrade at config-load before runs start).
- `agent.ts`
  - Add `transport?: TransportOption` to `AgentRunOptions`.
  - In `runAgent`, derive `effectiveCaps = adapter.capabilitiesFor?.(
    transport ?? "cli") ?? adapter.capabilities` and use that instead of
    `adapter.capabilities` for the HITL gate at line 217. Persist
    `transport` into both `adapter.invoke()` call sites (initial + resume)
    as a new field on `RuntimeInvokeOptions`.
- `node-dispatch.ts`
  - In `executeAgentNode`, resolve `const transport = resolveTransport(
    node, eng.config.defaults)` and forward it into `runAgent({..., transport})`
    AND `handleAgentHitl({..., transport})`.
- `loop.ts`
  - In the body-node executor branch, resolve `const transport =
    resolveTransport(bodyNode, config.defaults, loopNode)` and forward
    into `runAgent`.
- `hitl-handler.ts`
  - Accept `transport?: TransportOption` in `handleAgentHitl`'s options
    object (next to the existing `runtime` / `runtimeArgs` / `model` /
    `permissionMode` / `reasoningEffort` knobs) and forward it into the
    resumed `runAgent({..., transport})` call so HITL resume uses the
    same transport as the original attempt. A new focused assertion in
    `agent_runtime_test.ts` (or `hitl-handler_test.ts` if present)
    captures the resumed `RuntimeInvokeOptions` and asserts `transport`
    round-trips on the resume call.
  - Confirm `node-dispatch.ts` and `loop.ts` actually pass `transport`
    into BOTH the `runAgent` and the `handleAgentHitl` call sites
    (today they forward `runtime` / `runtimeArgs` / `model` /
    `permissionMode` / `reasoningEffort` and need the same treatment
    for `transport`).
- `output.ts` / dry-run rendering — when listing agent nodes in the
  dry-run plan, append ` [transport: acp]` next to nodes whose resolved
  transport is `"acp"`. Skip the suffix for `"cli"` (default; noiseless).
- `deno.json` — bump `@korchasa/ai-ide-cli` from `^0.8.7` to `^0.8.8`.
  Run `deno cache --reload deno.json` after the bump AND commit the
  updated `deno.lock` in the same change (omitting it breaks fresh-clone
  CI on the next pipeline run).
- `documents/requirements-engine/04-runtime-and-hooks.md` — add a new
  `### 3.77 FR-E77: Transport Selection (CLI vs ACP)` section using the
  canonical FR field set: `Description`, `Tasks` (back-link to this
  task), `Motivation`, `Decision` (none yet — omit), `Dep` (FR-E47-style
  none), `Acceptance criteria` with a single `**Tests:**` line listing
  the test files below.
- `documents/requirements-engine.md` — insert `FR-E77 (Transport
  Selection) → 04-runtime-and-hooks` in the FR-ID → Section File map.
- `documents/index.md` — register the FR-E77 row under `## FR` (already
  staged in step 5b with `fr-e77-tbd` anchor placeholder).
- `documents/design-engine/02-engine-modules-flow.md` — append one
  paragraph + a line in the data-flow diagram showing
  `WorkflowDefaults.transport → resolveTransport → AgentRunOptions.transport
  → adapter.invoke({transport})`.

### Tests (TDD order — RED → GREEN → REFACTOR → CHECK)

1. `runtime_test.ts` (NEW test cases inside the existing file, named
   `FR-E77 …`):
   - cascade `node → parent → defaults → "cli"` with all four levels
     covered;
   - body node inside a loop picks up loop-level transport when body
     omits it.
2. `config_test.ts`:
   - `defaults.transport` enum rejection;
   - per-node `transport` enum rejection;
   - `transport: acp` + `runtime: cursor` rejected at config load with
     the canonical error message;
   - `transport: acp` + `allowed_tools` warns via `OutputManager` (use
     a captured warning sink, mirroring the existing
     `validateRuntimeCompatibility` test pattern).
3. `agent_runtime_test.ts`:
   - assert `adapter.invoke()` receives `transport: "acp"` when caller
     passes it, on both initial and resume calls (uses the existing
     `calls: RuntimeInvokeOptions[]` capture pattern at lines 86-175).
4. `agent_test.ts`:
   - HITL injection guard reads `capabilitiesFor("acp")` when present —
     stub an adapter whose CLI vector has `mcpInjection: true` but ACP
     vector has `mcpInjection: false`, assert no `mcpServers` are
     emitted on the `acp` path.
5. `output_test.ts`:
   - dry-run plan output for an agent node with `transport: acp`
     contains the `[transport: acp]` suffix; default `cli` node has no
     suffix.
6. `engine_test.ts` (smoke): one happy-path integration test that loads
   a fixture workflow with `defaults.transport: acp`, runs the engine
   with an injected stub adapter, and asserts the stub's `invoke()` was
   called with `transport: "acp"`.

### Error-handling strategy

- Library throws on transport mismatch only at `adapter.invoke()`. The
  engine intercepts the same condition earlier in
  `validateRuntimeCompatibility` so config-load is the failure surface,
  not runtime. The runtime path KEEPS its own try/catch in `agent.ts`
  unchanged — defence in depth covers future adapters that flip
  `pilot: false → true` at runtime.
- `resolveTransport` is total (always returns a `TransportOption`). No
  exceptions to catch; consumers can use its result directly.
- HITL guard downgrade: when `capabilitiesFor(transport).mcpInjection`
  is `false` AND `defaults.hitl` is configured, emit a one-shot
  workflow-start warning (`OutputManager.warn`) that HITL is disabled
  for ACP nodes. Do not fail the workflow — workflows that don't trigger
  HITL still run fine.

### Log/transcript behaviour under ACP

ACP downgrades `transcript` to `false` (no exported `--output-format
json` artifact), but `extractAcpContent` (library FR-L23) still fills
the structured `result.output` fields (`result`, `session_id`,
`total_cost_usd`, `duration_ms`, …) that `saveAgentLog` consumes. The
JSONL transcript fallback at `log.ts` is best-effort and already warns
when missing — no engine change needed; the existing "JSONL transcript
not found" log line is the expected signal on ACP nodes.

### Verification commands

- `deno task check` — full lint + type-check + test suite.
- `deno task test runtime_test.ts config_test.ts agent_runtime_test.ts
  agent_test.ts output_test.ts engine_test.ts` — focused per-file pass.
- `deno run -A --no-check cli.ts run .flowai-workflow/github-inbox
  --dry-run` — manual smoke that dry-run renders the `[transport: acp]`
  suffix once a dogfood workflow opts in (after the bump).
- `rg '@korchasa/ai-ide-cli' deno.json` — confirm floor `^0.8.8`.

### Out of scope (explicit)

- Bumping the dogfood `.flowai-workflow/<name>/workflow.yaml` to
  `transport: acp` (separate FR-S follow-up — the engine change must
  ship first so dogfood can opt in cleanly).
- Plumbing ACP through `Engine.openSession()` (FR-E68 host integration);
  the library exposes it but no engine caller uses it yet.
- Exporting a transport-aware capability inventory through the embedded
  MCP server (FR-E73). Out of scope until E73 lands.

## Follow-ups

- After this lands, raise an FR-S issue to opt the dogfood Claude-driven
  workflows (`.flowai-workflow/github-inbox`, `autonomous-sdlc`) into
  `transport: acp` and measure session-fidelity / cost / latency deltas
  against the CLI baseline.
- Track upstream Cursor ACP front promotion (`pilot: false → true` in
  `runtime/acp/fronts.ts`); when that ships, drop the Cursor-specific
  compatibility check.
