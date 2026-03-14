---
variant: "Variant A: Minimal surgical removal"
tasks:
  - desc: "Remove failed-node.txt write block from engine.ts"
    files: ["engine/engine.ts"]
  - desc: "Fix JSDoc in sortPostPipelineNodes() — replace concrete node name with generic example"
    files: ["engine/engine.ts"]
  - desc: "Remove failed-node.txt tests from engine_test.ts"
    files: ["engine/engine_test.ts"]
  - desc: "Update meta-agent SKILL.md — remove failed-node.txt input reference, clarify state.json source"
    files: [".claude/skills/agent-meta-agent/SKILL.md"]
  - desc: "Update SDS — remove failed-node-id extraction from engine.ts description, fix Meta-Agent Trigger section"
    files: ["documents/design.md"]
---

## Justification

**Variant A** selected for three reasons:

1. **Vision alignment (AGENTS.md):** "Engine is domain-agnostic" and "Engine
   MUST NOT depend on any specific pipeline config." `failed-node.txt` is a
   pipeline-specific artifact the engine should never produce. Pure removal
   directly enforces this invariant. Variant B adds a new `getFailedNodeIds()`
   wrapper — introducing new API surface in a removal-only ticket contradicts
   the cleanup intent and risks new coupling.

2. **Minimal blast radius:** All changes are deletions of dead/redundant code.
   `state.json` `nodes[*].status` already provides failed-node context (meta-
   agent already reads it). No behavioral change. Grep confirms only 4 files
   reference `failed-node.txt`.

3. **Complexity trade-off:** Variant B adds scope creep (new function + test +
   SKILL.md reference). Variant C's expanded SDS rewrite is subsumed by
   Variant A's step 5 which already updates the two stale SDS references.
   Variant A achieves FR-29 compliance with minimum work.

## Task Descriptions

### Task 1: Remove failed-node.txt write block from engine.ts

Delete the 7-line block (lines 177–183) that writes `failed-node.txt` after
`runFailureHook()`. The surrounding `if (!pipelineSuccess)` block remains
intact — it still runs the failure hook. No replacement needed.

### Task 2: Fix JSDoc in sortPostPipelineNodes()

Replace the concrete example `commit-meta (inputs: [meta-agent])` at line 760
with a generic example like `node-b (inputs: [node-a])`. Eliminates the last
concrete node name reference in engine source.

### Task 3: Remove failed-node.txt tests from engine_test.ts

Delete the two test cases (lines 295–325) that verify `failed-node.txt`
writing. The `getNodesByStatus` test (line 275) is retained — it tests a valid
engine function unrelated to the artifact.

### Task 4: Update meta-agent SKILL.md

Remove the `failed-node.txt` bullet from the Input section (lines 37–38).
Add/clarify that failed node context comes from `state.json`
`nodes[*].status` field. No other SKILL.md changes.

### Task 5: Update SDS (documents/design.md)

Two targeted edits:
- Line 273: remove `failed-node-id extraction` from engine.ts description.
- Lines 598–599: update Meta-Agent Trigger to remove `reads failed-node.txt`
  reference, confirm `state.json`-based failure detection is the sole mechanism.
