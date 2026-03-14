---
variant: "Variant A: Remove failed-node.txt write; meta-agent reads state.json directly"
tasks:
  - desc: "Remove hardcoded failed-node.txt write block from engine.ts"
    files: ["engine/engine.ts"]
  - desc: "Fix JSDoc comment referencing concrete node name 'meta-agent'"
    files: ["engine/engine.ts"]
  - desc: "Update engine tests: remove/update failed-node.txt assertions"
    files: ["engine/engine_test.ts"]
  - desc: "Update meta-agent SKILL.md: remove failed-node.txt from Input section, use state.json exclusively"
    files: [".claude/skills/agent-meta-agent/SKILL.md"]
  - desc: "Update SDS: remove failed-node.txt references from design.md sections 3.6, 5"
    files: ["documents/design.md"]
---

## Justification

**Selected:** Variant A — direct removal of FR-29 violations with no new
abstractions.

**Why not B:** Adds `on_failure_artifact` config field — new validation logic,
new type surface, new docs — to preserve an artifact the spec declares
"redundant." Over-engineering a removal into a feature addition contradicts
AGENTS.md's "Engine is pipeline-independent" invariant: the engine should not
know about any artifact filenames, even configurable ones, when `state.json`
already carries the same data.

**Why not C:** If `on_failure_script` is not extended, outcome identical to A
with extra file touched. If extended, adds shell script complexity for
redundant data. No benefit over A.

**Vision alignment:** AGENTS.md states "Engine MUST NOT depend on any specific
pipeline config" and "Engine code must not reference concrete node names,
artifact filenames, or pipeline structure." Variant A directly enforces both
constraints by removing the two violations with zero new abstractions.

**Risk:** Meta-agent behavioral shift — must verify it correctly identifies
failed nodes from `state.json` `nodes[*].status === "failed"`. Low risk:
meta-agent already reads `state.json` as step 2 of its workflow; `failed-node.txt`
was supplementary, not primary.

## Task Descriptions

### Task 1: Remove hardcoded failed-node.txt write block from engine.ts

Delete lines 170-183 in `engine/engine.ts` that extract failed node ID via
`getNodesByStatus()` and write `failed-node.txt` to `run_dir`. This is the
primary FR-29 violation: engine writing a domain-specific artifact filename.
The `runFailureHook()` method that calls `on_failure_script` remains — only the
hardcoded artifact write is removed.

### Task 2: Fix JSDoc comment referencing concrete node name 'meta-agent'

Replace the `meta-agent` reference in the `sortPostPipelineNodes()` JSDoc
(line ~760) with a generic example (e.g., "post-pipeline nodes"). This is the
second FR-29 violation: engine source containing a concrete node name.

### Task 3: Update engine tests

Remove or update test assertions in `engine/engine_test.ts` (lines ~295-325)
that verify `failed-node.txt` creation. Tests should verify that `state.json`
correctly records failed node status instead.

### Task 4: Update meta-agent SKILL.md

Remove `failed-node.txt` from the Input section (~line 37-38) of
`.claude/skills/agent-meta-agent/SKILL.md`. Clarify that failed node
identification uses `state.json` exclusively (`nodes` entries with
`status: "failed"`).

### Task 5: Update SDS (design.md)

Remove `failed-node.txt` references from:
- Section 3.6 (Pipeline Engine): line ~582 mentioning write to
  `{{run_dir}}/failed-node.txt`
- Section 5 (Logic): line ~599-600 mentioning meta-agent reads
  `failed-node.txt`

Replace with: meta-agent identifies failed nodes via `state.json`
(`nodes[*].status === "failed"`).
