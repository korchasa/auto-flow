---
date: "2026-05-01"
status: to do
implements: [FR-E8]
tags: [refactor, library, hitl, cross-repo]
related_tasks:
  - 2026/05/hitl-detection-boundary.md
  - 2026/05/hitl-via-engine-mcp.md
cross_repo: korchasa/ai-ide-cli
---
# engine: Move HITL detection fully into `@korchasa/ai-ide-cli`

## Goal

Engine talks only to a normalized `HitlRequest | null` returned by the
runtime adapter. Per-runtime HITL detection (Claude
`permission_denials[]`, OpenCode NDJSON `tool_use`, future Cursor/Codex)
disappears from this repo entirely.

## Overview

### Context

Critique #8: HITL detection is dual-pathed in this repo —
`agent.ts`/`hitl.ts` know per-runtime tool names and event shapes.
Adding Cursor/Codex runtimes doubles surface. Library
(`@korchasa/ai-ide-cli`) already owns runtime adapters; HITL detection
belongs with the runtime that produces it.

### Current State

- `hitl.ts` (375 LOC) implements `handleAgentHitl`, polls scripts,
  resumes session — engine concerns.
- Detection logic lives partially in `agent.ts` (Claude-side scrape of
  `permission_denials[]`) and partially in OpenCode adapter inside
  `@korchasa/ai-ide-cli` (NDJSON sniffing + ephemeral MCP server
  injection via `OPENCODE_CONFIG_CONTENT`).
- Engine knows specific tool names: `AskUserQuestion`,
  `hitl_request_human_input`. Adding a runtime requires editing both
  repos.

### Constraints

- Cross-repo work: changes in
  [`korchasa/ai-ide-cli`](https://github.com/korchasa/ai-ide-cli) AND
  this repo. Library version bump ships first; this repo bumps the JSR
  pin in `deno.json` afterward.
- Library FRs prefixed `FR-L<N>` (per AGENTS.md scope rules).
- Engine retains the engine-level concerns: `state.json` persistence of
  HITL question, ask_script poll loop, session resume, timeout. Only
  detection moves.
- Library-embedding contract (FR-E60 process scoping) preserved.

## Definition of Done

### In `korchasa/ai-ide-cli`

- [ ] New interface (or extension of existing `Runtime`):
      `detectHitl(streamingEvents: AsyncIterable<RuntimeEvent>) →
      AsyncIterable<{ event, hitl?: HitlRequest }>`. Adapter wraps the
      runtime's native event stream and emits a normalized
      `HitlRequest` when its runtime-specific signal fires, then
      terminates the stream cleanly.
- [ ] Claude adapter: scans `permission_denials[]` post-invoke for
      `AskUserQuestion`. Returns normalized request.
- [ ] OpenCode adapter: owns the MCP-server injection +
      `OPENCODE_CONFIG_CONTENT` lifecycle + NDJSON sniffing. Engine
      sees only the normalized request.
- [ ] New library FRs (numbered FR-L<N>) for each runtime's HITL
      contract. SRS in sibling repo.
- [ ] Library version bump (semver-minor — new public surface).

### In this repo (after lib release)

- [ ] `agent.ts`: remove all `permission_denials`/tool-name awareness.
      Calls `adapter.detectHitl(...)` and treats the result as opaque.
- [ ] `hitl.ts`: shrink to engine-only concerns (persist question,
      poll ask_script, resume session). Remove tool-name strings.
      Target ≤ 200 LOC.
- [ ] `hitl-mcp-command.ts`, `hitl-handler.ts`: review for moves to
      lib (handler) or deletion (mcp-command lives in lib's OpenCode
      adapter).
- [ ] `deno.json`: bump `jsr:@korchasa/ai-ide-cli` to the new minor.
- [ ] FR-E8 (HITL) acceptance criteria rewritten: engine talks only to
      `Runtime.detectHitl`. Per-runtime mechanics moved to FR-L<N>
      cross-references.
- [ ] AGENTS.md "HITL via Runtime-Native Structured Requests" section
      replaced with one paragraph: "engine consumes
      `Runtime.detectHitl` results; per-runtime mechanics live in lib
      decision-tasks/FRs".

## Solution

### Phase 1 — Lib-side design (sibling repo)

1. Open issue in `korchasa/ai-ide-cli` referencing this task.
2. Define `RuntimeEvent` and `HitlRequest` shapes. Existing
   `HumanInputRequest` already in `@korchasa/ai-ide-cli/types` — reuse.
3. Add `detectHitl` method to each adapter. Move OpenCode MCP-injection
   + Claude denial-scanning code from this repo into the adapters.
4. Library tests: each adapter's HITL emission verified end-to-end.
5. Release library minor.

### Phase 2 — This repo

6. Update `deno.json` JSR pin.
7. Refactor `agent.ts`/`hitl.ts` to call `detectHitl` only.
8. Delete now-unreachable detection code; smoke-run all 4 workflows.
9. Rewrite FR-E8 + AGENTS.md HITL section.
10. Decision recorded in `2026/05/hitl-detection-boundary.md`.

### Verification

- `deno task check` green.
- Smoke: each of the 4 dogfood workflows triggers a HITL flow at least
  once (use a question artifact). Verify question persists in
  `state.json`, ask_script fires, resume succeeds.
- `grep -rn "AskUserQuestion\|permission_denials\|hitl_request_human_input"
  *.ts` outside test fixtures: zero hits.
- New runtime added to lib (e.g. Cursor) requires zero changes to this
  repo.
