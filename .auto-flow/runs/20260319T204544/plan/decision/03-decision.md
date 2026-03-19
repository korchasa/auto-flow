---
variant: "Variant C: Template + SDLC-Level Validation in check.ts"
tasks:
  - desc: "Update pipeline.yaml hitl.artifact_source to use template syntax"
    files: [".auto-flow/pipeline.yaml"]
  - desc: "Add interpolate() call in engine/hitl.ts:buildScriptArgs() for artifact_source"
    files: ["engine/hitl.ts"]
  - desc: "Add test for artifact_source interpolation in hitl_test.ts"
    files: ["engine/hitl_test.ts"]
  - desc: "Add hitlArtifactSource() validation function in scripts/check.ts"
    files: ["scripts/check.ts"]
  - desc: "Add test for hitlArtifactSource() in scripts/check_test.ts"
    files: ["scripts/check_test.ts"]
---

## Justification

I selected Variant C for three reasons:

1. **Engine domain-agnosticism preserved.** AGENTS.md states: "Engine is
   domain-agnostic: MUST NOT contain git, GitHub, branch, PR, or any
   domain-specific logic." Variant B places `artifact_source` format validation
   inside `engine/config.ts`, imposing a pipeline-specific convention (template
   syntax requirement) on the domain-agnostic engine. Variant C keeps validation
   in `scripts/check.ts` — pure SDLC pipeline scope.

2. **Follows established validation pattern.** FR-S24 established
   `pipelineIntegrity()` in `scripts/check.ts` as the SDLC-level config
   validation gate. Adding `hitlArtifactSource()` alongside it is consistent and
   discoverable. The `deno task check` pipeline is already the standard
   pre-commit gate, making this practically equivalent to parse-time for the
   SDLC workflow.

3. **Minimal cross-scope risk.** Variant A doesn't satisfy FR-S35 AC#2 (no
   parse-time error for hardcoded paths). Variant B is cross-scope
   (engine+sdlc). Variant C satisfies both ACs within a single scope (sdlc).

## Task Descriptions

### Task 1: Update pipeline.yaml hitl.artifact_source

Change `defaults.hitl.artifact_source` from hardcoded
`plan/specification/01-spec.md` to `{{input.specification}}/01-spec.md`.
Template syntax ensures the path adapts if the `specification` node is renamed.

### Task 2: Add interpolate() in hitl.ts:buildScriptArgs()

In `engine/hitl.ts`, modify `buildScriptArgs()` to accept a `TemplateContext`
parameter. Call `interpolate(config.artifact_source ?? "", ctx)` before pushing
the value to the args array. The `HitlRunOptions` already carries
`ctx: TemplateContext` — thread it through.

### Task 3: Add hitl interpolation test

Add test in `engine/hitl_test.ts` verifying that `buildScriptArgs()` resolves
`{{input.specification}}/01-spec.md` to the correct runtime path when given a
`TemplateContext` with `specification` mapped.

### Task 4: Add hitlArtifactSource() validation in check.ts

Add `hitlArtifactSource()` function in `scripts/check.ts` that:
- Reads `pipeline.yaml` via `loadConfig()` (can share config with
  `pipelineIntegrity()` or call independently).
- Checks `config.defaults?.hitl?.artifact_source` contains `{{input.`.
- Reports error if hardcoded path detected (no `{{` present).
- Follows existing pattern: label to stdout, `Deno.exit(1)` on failure.

### Task 5: Add check_test.ts test for hitlArtifactSource()

Add test in `scripts/check_test.ts` for the new validation function. Cover:
valid template path (pass), hardcoded path (fail), absent field (skip/pass).

## Summary

I selected Variant C (Template + SDLC-Level Validation in check.ts) for issue
#151 (FR-S35). This variant satisfies both acceptance criteria while keeping
the engine domain-agnostic per AGENTS.md. 5 tasks ordered by dependency:
pipeline config update → engine interpolation + test → SDLC validation + test.
Branch `sdlc/issue-151` created; draft PR opened.
