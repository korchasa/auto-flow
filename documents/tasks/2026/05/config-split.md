---
date: "2026-05-01"
status: to do
implements: [FR-E4, FR-E7, FR-E13, FR-E16, FR-E33, FR-E35, FR-E36, FR-E37, FR-E38, FR-E47]
tags: [refactor, config]
related_tasks:
  - 2026/05/engine-decomposition.md
  - 2026/05/symbolic-artifact-names.md
---
# engine: Split `config.ts` (1106 LOC) into parse / validate / resolve

## Goal

Separate the three abstraction levels currently entangled in
`config.ts`: YAML parsing & legacy normalization, semantic validation,
defaults cascade resolution.

## Overview

### Context

Critique #3: `config.ts` is 1106 lines, `config_test.ts` is 2018 lines.
Multiple concerns: YAML parse, `run_always`→`run_on` normalization,
template-var validation in hooks, file-reference existence checks, loop
input forwarding (FR-E35), condition-field consistency (FR-E36), worktree
pre-parse, cascade resolution (`resolveBudget`, model, runtime, effort,
tools).

### Current State

- `loadConfig` orchestrates parse + validate.
- `validateNode` is 200+ LOC handling 4 distinct rule families.
- `resolveBudget` is exported and called from `engine.ts`, `loop.ts`,
  `node-dispatch.ts` — utility leaks across modules.
- `extractWorktreeDisabled` does a separate raw-YAML pre-parse — engine
  needs the flag before full config load.

### Constraints

- Public exports from `config.ts` re-exported via shim during transition;
  callers (`engine.ts`, `cli.ts`, `node-dispatch.ts`, `loop.ts`) need not
  change in same PR.
- Must not regress `deno task check` (config validation is invoked there).
- Test suite split by module — no test deletion.
- Lands AFTER engine decomposition so cascade resolvers can move
  cleanly into `BudgetGuard` etc.

## Definition of Done

- [ ] New `config-parse.ts`: YAML→objects + legacy normalization
      (`run_always`→`run_on`, default fills). ≤ 250 LOC.
- [ ] New `config-validate.ts`: all semantic checks (template vars in
      hooks, file references, loop inputs forwarding, condition-field
      consistency, mutual-exclusion rules). ≤ 400 LOC.
- [ ] New `config-resolve.ts`: cascade resolvers (`resolveBudget`,
      `resolveModel`, `resolveRuntime`, `resolveEffort`, `resolveTools`).
      ≤ 250 LOC.
- [ ] `config.ts` becomes a thin façade: `loadConfig = parse → validate →
      return` + back-compat re-exports. ≤ 100 LOC.
- [ ] Per-module test files: `config_parse_test.ts`,
      `config_validate_test.ts`, `config_resolve_test.ts`. Each ≤ 600
      LOC.
- [ ] No regression in any FR-E acceptance criterion that mentions
      config validation (E4, E7, E13, E16, E33, E35, E36, E37, E38, E47).
- [ ] SDS engine `01-engine-modules-core.md` updated: `config.ts` entry
      replaced with three module entries, dependency arrows updated.

## Solution

### Step 1 — Extract `config-resolve.ts` (lowest coupling)

Move `resolveBudget` + add resolvers for the other cascade fields (model,
runtime, effort, tools). Update `engine.ts`, `loop.ts`, `node-dispatch.ts`
imports. Keep re-export from `config.ts` for one release.

### Step 2 — Extract `config-validate.ts`

Move `validateNode`, `validateFileReferences`, `validateTemplateVars`,
loop-input forwarding check, condition-field check. Single entry
`validateConfig(config, workDir, workflowDir)`. `loadConfig` in
`config-parse.ts` calls it.

### Step 3 — Slim `config-parse.ts`

Pure parse + normalization. Returns `ParsedConfig` (post-normalization,
pre-validation). `extractWorktreeDisabled` stays here (it's a parse-time
extraction, not validation).

### Step 4 — `config.ts` façade

```typescript
export { loadConfig } from "./config-parse.ts";
export { resolveBudget, ... } from "./config-resolve.ts";
// Back-compat re-exports for one release; deprecate in next.
```

### Verification

- `deno task check` green.
- All 4 dogfood workflows: load + dry-run produces identical plan output.
- Targeted bench: `time deno run -A cli.ts run --dry-run
  .flowai-workflow/github-inbox` — no perf regression > 5%.
- `wc -l config*.ts config_*_test.ts` — totals stay roughly equivalent
  to pre-split.
