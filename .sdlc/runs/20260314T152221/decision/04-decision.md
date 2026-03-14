---
variant: "Variant A: Phase Registry First (FR-E9 only, defer FR-E5 + FR-E7)"
tasks:
  - desc: "Implement phase registry functions in engine/state.ts"
    files: ["engine/state.ts"]
  - desc: "Add phase-aware path logic to getNodeDir()"
    files: ["engine/state.ts"]
  - desc: "Wire setPhaseRegistry() in engine run() before ensureRunDirs()"
    files: ["engine/engine.ts"]
  - desc: "Export phase registry functions from engine/mod.ts"
    files: ["engine/mod.ts"]
  - desc: "Add tests for phase-aware getNodeDir() and registry functions"
    files: ["engine/state_test.ts"]
  - desc: "Verify SDLC pipeline.yaml nodes have phase fields (FR-S25)"
    files: [".sdlc/pipeline.yaml"]
  - desc: "Update dashboard path computation for phase-aware layout"
    files: ["scripts/generate-dashboard.ts"]
---

## Justification

I selected Variant A (FR-E9 Phase Registry only) over Variants B and C for
these reasons:

1. **Highest-impact, focused scope.** FR-E9 is the most complex and valuable
   of the three FRs. It unblocks FR-S25 (phase-organized SDLC artifact
   directories) and activates the phase layout already documented in engine
   SDS section 3.2 but never implemented. Focused scope reduces risk for an engine-core
   change that touches all `getNodeDir()` callers (engine.ts, template.ts,
   loop.ts).

2. **Domain-agnostic engine alignment.** Per AGENTS.md vision, the engine is a
   "universal DAG-based engine for orchestrating AI agents" that is
   domain-agnostic. Phase registry is a pure engine concern — it adds
   structured artifact directory layout without any domain-specific logic.
   This aligns with the key decision that engine "MUST NOT contain git,
   GitHub, branch, PR, or any domain-specific logic."

3. **Independent FRs deserve separate issues.** FR-E7/FR-S24 (config drift
   detection) is valuable but completely independent of FR-E9 — no shared
   code paths, no blocking dependency. Bundling them increases failure
   surface without benefit. FR-E5 (project dir structure) is a spec-alignment
   question (move files vs update spec to match reality), not a code change —
   it deserves its own focused discussion.

4. **Backward compatibility built-in.** The `getNodeDir()` design already
   handles the no-phase case: if no phase is in the registry for a node, it
   returns the flat `${runDir}/${nodeId}` path. Existing runs without phases
   remain resumable. This eliminates the primary risk flagged in the plan.

## Task Descriptions

### Task 1: Implement phase registry functions in engine/state.ts

I add three functions per engine SDS section 3.2 design:
- `setPhaseRegistry(config)` — builds `Map<string, string>` from pipeline
  config's `phases` declaration and per-node `phase` fields. Called once at
  run start.
- `clearPhaseRegistry()` — clears the module-scoped map (for test isolation).
- `getPhaseForNode(nodeId)` — returns phase string or undefined.

Module-scoped `Map<string, string>` stores nodeId-to-phase mapping.

### Task 2: Add phase-aware path logic to getNodeDir()

I modify `getNodeDir()` (currently `engine/state.ts:56-57`) to check the
phase registry: if `getPhaseForNode(nodeId)` returns a phase, return
`${runDir}/${phase}/${nodeId}/`; otherwise return flat `${runDir}/${nodeId}/`.
This is the only code path that determines artifact directory layout.

### Task 3: Wire setPhaseRegistry() in engine run() before ensureRunDirs()

I call `setPhaseRegistry(config)` in `engine/engine.ts` `run()` function
before `ensureRunDirs()` — in both fresh-run and `--resume` code paths.
This ensures phase-aware directories are created from the start.

### Task 4: Export phase registry functions from engine/mod.ts

I add exports for `setPhaseRegistry`, `clearPhaseRegistry`,
`getPhaseForNode` from `engine/mod.ts` so they're available to consumers.

### Task 5: Add tests for phase-aware getNodeDir() and registry functions

I add test cases to `engine/state_test.ts`:
- `getNodeDir()` returns flat path when no phase registry is set.
- `getNodeDir()` returns phase-aware path when node has phase in registry.
- `setPhaseRegistry()` correctly builds map from config.
- `clearPhaseRegistry()` resets to empty state.
- `getPhaseForNode()` returns undefined for unknown nodes.

### Task 6: Verify SDLC pipeline.yaml nodes have phase fields (FR-S25)

I verify all SDLC pipeline nodes have `phase:` field set. Per the plan,
current config already has: `specification`, `design`, `decision` with
`phase: plan`; `implementation` with `phase: impl`; `tech-lead-review`,
`optimize` with `phase: report`. Confirm no nodes are missing phase fields.

### Task 7: Update dashboard path computation for phase-aware layout

I update `scripts/generate-dashboard.ts` stream log path computation to
use phase-aware paths. The CLI entry point scans node directories — with
phase registry active, paths change from `<nodeId>/stream.log` to
`<phase>/<nodeId>/stream.log`. The `streamLogHref` computation already
handles this case per SDS section 3.7 but must align with actual `getNodeDir()`
output.

## Summary

- I selected Variant A (FR-E9 Phase Registry only) for its focused scope,
  lowest risk, and highest impact — it unblocks FR-S25 and aligns with the
  domain-agnostic engine vision.
- I defined 7 tasks ordered by dependency: registry functions, path logic,
  engine wiring, exports, tests, pipeline verification, dashboard update.
- I created branch `sdlc/issue-96` and opened a draft PR.
