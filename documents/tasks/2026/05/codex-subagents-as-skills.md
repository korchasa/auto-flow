---
date: "2026-06-02"
status: in progress
implements:
  - FR-E76  # new: Codex subagent delivery as skills (orchestrator/supervisor)
---
# Codex Subagent Delivery as Skills

## Goal

Make the flowai orchestration surface (`orchestrate`/`supervise`) actually
work on Codex hosts. Today the plugin ships `orchestrator`/`supervisor` as
Claude/OpenCode **agents**, but the Codex plugin manifest has no `agents`
pointer (only `skills`/`mcpServers`/`apps`), so on Codex the two operational
agents are inert and `/orchestrate` dead-ends at the dispatcher's
"no native subagent dispatch → stop" fallback. Deliver the operational
subagents to Codex **as skills**, while preserving the context-isolation
invariant via Codex's native `worker` subagent.

## Overview

### Context

- Plugin source tree: shared interactive surface under
  `plugin-src/shared/skills/` (`run`, `init`, `scaffold`, `orchestrate`,
  `supervise`) + `plugin-src/shared/agents/` (`orchestrator`, `supervisor`).
  Host wiring under `plugin-src/{claude,codex}/`.
- `scripts/build-plugin-payload.ts::classifyPayloadFile` routing:
  - `plugin-src/shared/<rest>` → copied to BOTH hosts at
    `plugins/flowai-workflow/<rest>` (with `{{FLOWAI_PLUGIN_ROOT}}` token
    render via `renderSharedRuntimeText`).
  - `plugin-src/<host>/<rest>` → copied to that host ONLY at `<host>/<rest>`;
    the other host gets `null`.
- Dispatch graph (`AGENTS.md` "Plugin agents/skills layout"): parent →
  `skills/orchestrate` → subagent `orchestrator` (returns
  `SUPERVISOR_DELEGATION`) → parent → subagent `supervisor` (returns
  `SUPERVISOR_REPORT`) → loop. Dispatch always via parent because some hosts
  cannot launch nested subagents.
- Current dispatcher branches (`plugin-src/shared/skills/orchestrate/SKILL.md:17-31`,
  `supervise/SKILL.md:15-21`): "Claude Code: `Agent`/`Task`
  `subagent_type=…`; OpenCode: `@mention`". No Codex branch; the
  "no native subagent dispatch → stop" guard (`orchestrate:46`,
  `supervise:33`) fires on Codex.
- Codex capabilities (R&D `documents/ides-difference/openai-codex.md`):
  - §6: skills at `.codex/skills/<name>/SKILL.md`; invoked via
    `$skill-name` (§4). Plugin-bundled via `skills: "./skills/"` pointer —
    already declared in `plugin-src/codex/.../plugin.json:18`.
  - §1/§9: native subagents, built-in `default`/`explorer`/`worker`;
    `max_depth=1` (a subagent cannot spawn another) — so the parent must do
    all dispatching, same constraint the existing graph already assumes.
  - §11: plugin manifest component pointers are `skills`/`mcpServers`/`apps`
    ONLY — NO `agents`. Confirmed: agents cannot be plugin-bundled on Codex.

### Current State

- `plugin-src/shared/agents/orchestrator.md`, `supervisor.md` — Claude/OpenCode
  agent format (frontmatter `tools/model/effort/maxTurns`). Copied verbatim to
  BOTH hosts by `classifyPayloadFile`; inert on Codex (no `agents` pointer).
- `plugin-src/shared/skills/orchestrate/SKILL.md`, `supervise/SKILL.md` —
  dispatchers; Claude/OpenCode branches only.
- `plugin-src/codex/` holds only `marketplace.json`, `.codex-plugin/plugin.json`
  (`skills` pointer present), `.mcp.json`. No Codex-specific skills yet; the
  shared skills land in the Codex payload at build time.
- `scripts/build-plugin-payload_test.ts` asserts
  `plugin-src/shared/agents/supervisor.md` → `<host>/…/agents/supervisor.md`
  for BOTH hosts (`:42-43`, `:338-349`).
- No skill/agent frontmatter validator in `scripts/check.ts` (verified) — new
  `SKILL.md` files are not linted beyond fmt.

### Constraints

- Engine stays domain/transport-agnostic; this is plugin-surface (host wiring),
  not engine-core logic.
- Preserve context isolation: the expensive artifact reading (orchestrator:
  policy files; supervisor: `runs/`, `state.json`, `journal.jsonl`, node
  artifacts) MUST run in an isolated Codex `worker` subagent, NOT the parent
  context (user-selected variant **B**).
- Keep the **dispatcher + worker-skill split** (user-selected): `orchestrate`/
  `supervise` stay thin dispatchers; `orchestrator`/`supervisor` operational
  logic ships as separate Codex skills.
- No silent fallbacks. Where a Codex capability is unverified (worker invoking
  `$skill`), document the primary path + explicit fallback + a manual smoke
  test — do NOT assume.
- TDD for the only test-lockable logic (`classifyPayloadFile`). Skill/doc
  content is markdown — verified via payload build + manual Codex smoke.
- `deno task check` green (incl. `deno publish --dry-run`).
- Drift caveat (`AGENTS.md`): the Codex `orchestrator`/`supervisor` skill
  bodies intentionally diverge from the Claude agent bodies (Codex
  worker-spawn framing vs Claude `subagent_type`). Document the divergence;
  the shared agent files remain the Claude/OpenCode source of truth.

### Decisions (locked with user)

- **Variant B** — Codex skill drives a native `worker` subagent (isolation
  preserved); NOT in-context execution (variant A rejected).
- **Dispatcher + worker-skill split** — keep `orchestrate`/`supervise`
  dispatchers; add Codex-only `orchestrator`/`supervisor` skills.
- **Static Codex skill files** under `plugin-src/codex/…/skills/` (auto-routed
  to Codex only), NOT build-time generation from the shared agents. Rationale
  (Reframe rule): Codex skill content is a NEW concern (worker-delegation
  semantics) wearing the same shape, not the same content as the Claude agent
  — a separate authored file is architecturally honest and keeps the
  release-critical payload builder simple. Divergence documented in AGENTS.md.
- **Codex no longer ships the inert `agents/` directory** — `classifyPayloadFile`
  drops `plugin-src/shared/agents/*` for host=codex (dead weight; misleading).

### Verification results (settled by experiment — codex-cli 0.135.0)

Ran live experiments against the real Codex CLI (`/tmp/codex-skill-exp`,
`codex exec --json -s workspace-write`, ChatGPT auth):

- **Skills auto-surface in `exec`.** With a skill referenced by NAME only (no
  path), the model reported it knew `probe` "from the already-provided
  context, without searching" → Codex injects available skills (name +
  description) into the agent context. Invocation = read the `SKILL.md` body
  and follow it.
- **A `worker` subagent CAN load a skill by name (variant B confirmed).** When
  the parent was told to delegate, it called the multi-agent collab tool
  `spawn_agent` with the prompt "Ты подагент `worker`… invoke the skill named
  `probe`" — passing the skill BY NAME, not inlining its body. A separate
  worker thread (`019e7da1…`, distinct from parent `019e7da0…`) loaded and
  executed the skill, wrote the marker, and reported back; the parent only ran
  a verification `test -e`. Multi-agent primitives observed: `spawn_agent`,
  `wait`, `close_agent` (+ `agents_states`).
- **Consequence:** the earlier "fallback (parent inlines skill body)"
  uncertainty is dropped — the primary path (worker invokes the operational
  skill by name) works natively. `multi_agent`, `plugins`, `skills`, `hooks`,
  `apps` are all `stable` in `codex features list`. `max_depth=1` still holds
  (parent dispatches; our graph already assumes this).

## Definition of Done

- [x] FR-E76 added to SRS (`requirements-engine/07-mcp-and-plugin-runtime.md`),
      cross-refs FR-E70/E74; index updated.
      Evidence: `documents/requirements-engine/07-mcp-and-plugin-runtime.md:176`
      (§3.76), `documents/requirements-engine.md:114`.
- [x] SDS updated: Codex subagent-as-skill dispatch in plugin-runtime design;
      `AGENTS.md` "Plugin agents/skills layout" gains a Codex variant note +
      drift note.
      Evidence: `AGENTS.md` "Codex variant (FR-E76)" subsection (search
      "Codex variant (FR-E76)") + drift caveat.
- [x] `classifyPayloadFile(host="codex", "plugin-src/shared/agents/<x>.md")`
      returns `null`; `host="claude"` still routes to `…/agents/<x>.md`.
      Evidence: `scripts/build-plugin-payload.ts:147` (`host === "codex" && relPath.startsWith("plugin-src/shared/agents/")` → `null`).
- [x] Codex skills `plugin-src/codex/plugins/flowai-workflow/skills/orchestrator/SKILL.md`
      and `…/skills/supervisor/SKILL.md` authored; payload build places them
      under `codex/…/skills/{orchestrator,supervisor}/SKILL.md` and the Claude
      payload does NOT contain them.
      Evidence: `plugin-src/codex/plugins/flowai-workflow/skills/orchestrator/SKILL.md`,
      `plugin-src/codex/plugins/flowai-workflow/skills/supervisor/SKILL.md`;
      `scripts/build-plugin-payload_test.ts:428` ("codex payload should not carry shared agents").
- [x] Shared `orchestrate`/`supervise` dispatchers gain a Codex branch (spawn
      `worker` → run `$orchestrator`/`$supervisor` → return structured block;
      fallback documented). The "no native dispatch → stop" guard no longer
      fires on Codex.
      Evidence: `plugin-src/shared/skills/orchestrate/SKILL.md:23,37`,
      `plugin-src/shared/skills/supervise/SKILL.md:21`.
- [x] `build-plugin-payload_test.ts` updated: codex-agents-dropped +
      codex-skills-present + claude-unaffected assertions (FR-E76;
      regression-locked).
      Evidence: `scripts/build-plugin-payload_test.ts:60` ("FR-E76 codex drops shared agents, claude keeps them, codex skills route to codex only").
- [x] `deno task check` green; `deno task sync-plugins -- --dry-run` shows the
      two new Codex skills and no Codex `agents/` entries.
      Evidence: `deno task check` exit 0; dry-run builds 90 files and the
      payload carries `codex/…/skills/{orchestrator,supervisor}/SKILL.md`
      with no plugin `agents/` entry under `codex/`, while
      `claude/…/agents/{orchestrator,supervisor}.md` are kept.
- [ ] Manual Codex smoke (manual — korchasa): install via
      `deno task sync-plugins-local`; in a Codex session `$orchestrate`
      spawns a `worker`, the worker loads the `orchestrator` skill, and the
      loop reaches a `SUPERVISOR_DELEGATION` / `SUPERVISOR_REPORT` round.
      (Worker-loads-skill capability already proven standalone — this smoke
      validates the plugin-bundled install path end-to-end.)

## Solution

### Step 1 — SRS (doc-first)

Add **FR-E76: Codex Subagent Delivery as Skills** to
`requirements-engine/07-mcp-and-plugin-runtime.md` after FR-E74. Canonical
field order (Description, Tasks, Motivation, Dep, Acceptance criteria).
Description subsections: (a) problem — Codex manifest has no `agents` pointer;
(b) delivery — `orchestrator`/`supervisor` shipped as Codex skills under the
plugin `skills/` pointer; (c) isolation — Codex dispatcher branch spawns a
native `worker` subagent that runs the operational skill (variant B), so
artifact reading stays out of the parent; (d) payload — Codex drops the inert
`agents/` dir; new skills auto-route via `plugin-src/codex/`. `Dep: FR-E70,
FR-E74`. Update index `requirements-engine.md` FR-E76 → 07-mcp-and-plugin-runtime.
Watch the 30 KB/file budget — compress; split is not expected.

### Step 2 — SDS + AGENTS.md

- `design-engine/` plugin-runtime section (same file family as FR-E73/E74):
  add the Codex dispatch path (parent → `$orchestrate` → worker(`$orchestrator`)
  → `SUPERVISOR_DELEGATION` → parent → worker(`$supervisor`) →
  `SUPERVISOR_REPORT` → loop) and the payload routing (codex skills static,
  codex agents dropped).
- `AGENTS.md` "Plugin agents/skills layout": add a Codex sub-bullet — on Codex
  the operational subagents ship as skills (`$orchestrator`/`$supervisor`)
  driven by a native `worker`; record the intentional body divergence from the
  Claude agents (drift caveat).

### Step 3 — `build-plugin-payload.ts::classifyPayloadFile` (TDD)

- RED: in `build-plugin-payload_test.ts`, assert
  `classifyPayloadFile("codex", "plugin-src/shared/agents/supervisor.md") === null`
  and `classifyPayloadFile("claude", "plugin-src/shared/agents/supervisor.md")
  === "claude/plugins/flowai-workflow/agents/supervisor.md"`. Update the
  existing both-hosts agent assertions (`:42-43`, `:338-349`) to the
  claude-only shape. Add full-build assertions: codex payload contains
  `codex/plugins/flowai-workflow/skills/orchestrator/SKILL.md` +
  `…/supervisor/SKILL.md`; claude payload does NOT; codex payload does NOT
  contain `codex/…/agents/`.
- GREEN: in `classifyPayloadFile`, before the shared-prefix copy, special-case
  `host === "codex" && relPath.startsWith("plugin-src/shared/agents/")` →
  return `null`. Leave shared `skills/` and the `plugin-src/codex/` host branch
  untouched (the new Codex skills route through the existing host-prefix arm).
- REFACTOR: keep the special-case minimal + commented (why: Codex has no
  `agents` manifest pointer).

### Step 4 — Codex operational skills (authored markdown)

Author two files (no engine logic; verified by build + smoke):

- `plugin-src/codex/plugins/flowai-workflow/skills/orchestrator/SKILL.md` —
  Codex frontmatter (`name: orchestrator`, `description:` from the agent,
  `effort: high`; DROP `tools/model/maxTurns`). Body = orchestrator operational
  logic adapted from `plugin-src/shared/agents/orchestrator.md` (policy
  loading, selection rules, continuation override, `SUPERVISOR_DELEGATION`
  contract, history append, stop conditions). Framing: "You run inside an
  isolated Codex worker subagent spawned by `$orchestrate`. Read policy, append
  history, return exactly one `SUPERVISOR_DELEGATION` block as your final
  message." Keep `Out of scope: runs/**, state.json, …`.
- `…/skills/supervisor/SKILL.md` — Codex frontmatter (`name: supervisor`,
  `description:`, `effort: high`). Body = supervisor operational logic adapted
  from `plugin-src/shared/agents/supervisor.md`: attach modes (`fresh`,
  `attach-live`, `resume-after-fail`), turn-budget guard
  (`status: running, repeat: true`), `SUPERVISOR_REPORT` contract (fields:
  `workflow`, `run_id`, `status`, `node`, `evidence`, `root_cause`,
  `fix_surface`, `resume_cmd`, `fixes`, `repeat`, `blocker`). Framing: isolated
  worker; return the `SUPERVISOR_REPORT` block as final message.

(`supervisor.md` shared agent body to be read during implementation — not yet
in context — to copy the exact attach-mode/report wording.)

### Step 5 — Dispatcher Codex branch (shared skills)

Edit `plugin-src/shared/skills/orchestrate/SKILL.md` and `supervise/SKILL.md`
(shared → lands in all hosts; just add a Codex bullet alongside Claude/OpenCode):

- orchestrate "Dispatch Loop" step 1 + step 3: add
  "- Codex: spawn a native `worker` subagent (the parent dispatches; Codex
  `max_depth=1` forbids nested spawns) and instruct it — by skill NAME — to
  invoke the `orchestrator` skill and return the `SUPERVISOR_DELEGATION`
  block as its final message. The worker, not the parent, performs all reads."
  (Verified live: a Codex worker loads a skill by name in its isolated
  thread — see Verification results.)
- supervise "Delegate": add the analogous Codex bullet for the `supervisor`
  skill.
- Update the guard wording (`orchestrate:46`, `supervise:33`): Codex HAS native
  subagent dispatch — the guard now applies only to hosts with neither subagent
  nor worker support.

### Step 6 — CHECK + payload + smoke

- `deno task check` (fmt+lint+test+slow-types). Fix to green.
- `deno task sync-plugins -- --dry-run` — confirm the two Codex skills appear
  and no `codex/…/agents/` entries remain.
- Manual Codex smoke (DoD) — settle the worker-`$skill` open question; if the
  fallback path is the one that works, tighten the dispatcher wording to lead
  with it.

### Out of scope / follow-ups

- Generating the Codex skills from the shared agents at build time
  (single-source) — rejected for now (Reframe: distinct concern); revisit only
  if the bodies converge.
- TOML `[agents.<name>]` delivery via `init`/scaffold (the old Branch A) —
  superseded by this skills-based approach for the plugin distribution path.
- OpenCode parity audit for the same gap — separate task.
