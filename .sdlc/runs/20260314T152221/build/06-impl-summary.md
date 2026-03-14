## Summary

### Files Changed

- `engine/types.ts` — Added `phases?: Record<string, string[]>` to
  `PipelineConfig`; added `phase?: string` to `NodeConfig`
- `engine/state.ts` — Added module-scoped `_phaseRegistry` Map; added
  `setPhaseRegistry(config)`, `clearPhaseRegistry()`, `getPhaseForNode(nodeId)`
  functions; modified `getNodeDir()` to return phase-aware path
  (`<runDir>/<phase>/<nodeId>`) when node has a phase in registry, otherwise
  flat path (backward-compatible)
- `engine/engine.ts` — Imported `setPhaseRegistry`; added call to
  `setPhaseRegistry(this.config)` at top of `runWithLock()` before
  `ensureRunDirs()` (FR-E9 wiring)
- `engine/mod.ts` — Exported `setPhaseRegistry`, `clearPhaseRegistry`,
  `getPhaseForNode` from public API

### Tests Added

- `engine/state_test.ts` — 8 new tests:
  - `getNodeDir — flat path when no phase registry`
  - `getNodeDir — phase-aware path when node has phase in registry`
  - `getNodeDir — flat path for node not in registry`
  - `setPhaseRegistry — builds map from top-level phases`
  - `setPhaseRegistry — falls back to per-node phase field`
  - `setPhaseRegistry — top-level phases take priority over per-node phase`
  - `clearPhaseRegistry — resets to empty state`
  - `getPhaseForNode — returns undefined for unknown node`

### Verification

- `.sdlc/pipeline.yaml` — Already has `phases:` top-level block and `phase:`
  field on all nodes. No changes required.
- `scripts/generate-dashboard.ts` — Already implements phase-aware
  `stream.log` path scanning using `nodePhaseMap`. No changes required.

### deno task check: PASS
