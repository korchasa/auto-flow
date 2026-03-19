---
variant: "Variant A: Inline validation in existing functions"
tasks:
  - desc: "Add parse-time condition_field vs frontmatter_field cross-check in validateNode() loop branch"
    files: ["engine/config.ts", "engine/config_test.ts"]
  - desc: "Add runtime presence check in extractConditionValue() — throw on undefined"
    files: ["engine/loop.ts", "engine/loop_test.ts"]
  - desc: "Add frontmatter_field verdict rule to verify node validate block"
    files: [".auto-flow/pipeline.yaml"]
---

## Justification

I selected Variant A because it directly satisfies both FR-E36 (parse-time +
runtime) and FR-S37 with minimal code change (~15 new lines across 2 engine
files + 4 YAML lines). The inline approach fits the existing `validateNode()`
pattern where all loop-specific checks live in the same branch — consistent
with FR-E35's inline loop input forwarding validation (SDS §3.1 config.ts).
This aligns with AGENTS.md's "fail fast, fail clearly" strategy and the engine's
domain-agnostic design: the check is generic (any loop's `condition_field` vs
any condition node's `validate` block), not SDLC-specific.

Variant B's aggregate-error benefit is marginal — most pipelines have 1 loop.
The added exported function increases `config.ts` public API surface without
proportional value. Variant C is non-compliant with FR-E36's explicit parse-time
acceptance criteria and defers the harder problem as tech debt.

## Task Descriptions

### Task 1: Parse-time condition_field validation (engine/config.ts)

In `validateNode()` loop branch, after existing `condition_node` reference
validation (~line 233) and after FR-E35's input forwarding check: inspect the
condition node's `validate` array for a `frontmatter_field` rule whose `field`
matches `condition_field`. If the condition node HAS a `validate` block but NO
matching rule, throw:
`"Loop '<id>' condition_field '<field>' is not declared as a frontmatter_field in condition node '<condId>' validate block"`.
If condition node has no `validate` block at all, skip (no contract to enforce).

Tests: 2 new cases in `config_test.ts` — (1) missing rule triggers error,
(2) present rule passes silently. Risk: `extractConditionValue` signature may
need loop node ID for runtime error message — verify before implementing.

### Task 2: Runtime presence check (engine/loop.ts)

In `extractConditionValue()` (~line 175), after the search loop completes: if
return value is `undefined`, throw:
`Error("Loop '<loopId>': condition_field '<field>' not found in condition node '<condId>' output at '<nodeDir>'")`.
This requires threading `loopId` through the call — verify current signature and
adjust minimally (closure capture or param addition).

Tests: 1-2 new cases in `loop_test.ts` — missing field throws descriptive error.

### Task 3: SDLC pipeline.yaml update

Add `frontmatter_field` rule to `verify` node's `validate` block:
```yaml
- type: frontmatter_field
  path: "{{node_dir}}/05-qa-report.md"
  field: verdict
  allowed: ["PASS", "FAIL"]
```

No test needed — covered by existing `deno task check` pipeline integrity
validation which calls `loadConfig()`.

## Summary

I selected Variant A (inline validation in existing functions) for issue #155.
It satisfies FR-E36 (parse-time + runtime loop condition field validation) and
FR-S37 (verify node verdict frontmatter rule) with minimal blast radius — 3
tasks, 5 files affected. Branch `sdlc/issue-155` created, draft PR opened.
