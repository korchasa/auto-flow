# Tech Lead Review — PR #180

## Verdict: MERGE

## CI Status
- No GitHub Actions configured (no `.github/` directory) — expected. Local `deno task check` (569 tests, 0 failures) serves as the quality gate.

## Findings

### Non-blocking
- None.

### Blocking
- None.

## Scope Check

- In scope: `engine/template.ts`, `engine/config.ts`, `engine/template_test.ts`, `engine/config_test.ts`, `documents/requirements-engine.md`, `documents/design-engine.md`, pipeline memory files, run artifacts.
- Out of scope: none.

All changed source files are `engine/` scope. `requirements-engine.md` and `design-engine.md` are the correct SRS/SDS for `scope: engine`. Decision variant B explicitly lists the four implementation files; SRS and SDS updates are mandatory per planning rules.

## Implementation Verification

- **AC1** (load-time validation of `{{...}}` in hooks): `engine/config.ts:321-344` calls `validateTemplateVars(node.before, allNodeIds)` / `validateTemplateVars(node.after, allNodeIds)` inside `validateNode()`, which is called from `parseConfig()` → `loadConfig()`. Correct chain.
- **AC2** (fail-fast at `loadConfig()`): `engine/config.ts:326-333` / `336-343` throws synchronously when `errors.length > 0`. 8 `assertThrows` integration tests confirm rejection of invalid hooks.
- **AC3** (error message identifies hook type + node ID): `engine/config.ts:329` — `Node '${id}' before hook has invalid template variables: ...`; `:339` — `after hook`. Tests at `config_test.ts` assert both `"my-node"` and `"after hook"` / `"before hook"` strings.
- **AC4** (`deno task check` integration): 569 tests pass (up from 549 — 20 new tests). Chain: `pipelineIntegrity()` → `loadConfig()` → `parseConfig()` → `validateSchema()` → `validateNode()` → `validateTemplateVars()`.
- **AC-SRS**: `requirements-engine.md` in diff; FR-E7 at lines 137-140 has 4 detailed `[x]` criteria with evidence.

`validateTemplateVars()` in `engine/template.ts:121-181` correctly mirrors `resolve()` prefix logic: `input` (suffix ∈ knownInputs), `env`/`args` (any suffix valid), `loop` (only `.iteration`), direct keys (`run_dir`, `run_id`, `node_dir`), `file("...")` pattern. Pure function returns error array — accumulates all errors before caller throws. Design is sound.

Loop body node handling: recursive `validateNode()` call already passes `[...allNodeIds, ...bodyNodeIds]` as `validInputIds` — body siblings correctly visible in hook `input.*` references. Test at `config_test.ts` ("loop body node hook uses combined IDs") confirms this.

## Working Tree

- Clean: yes
- Uncommitted files: none

## Summary

MERGE. QA PASS (569 tests, 0 failures), 5/5 AC, no CI (expected), clean working tree. FR-E7 hook template variable validation fully implemented: `validateTemplateVars()` pure function in `template.ts` + fail-fast hook validation in `config.ts` `validateNode()`. No blocking findings.
