---
variant: "Variant A: Regex-based in resolve() with single-pass approach"
tasks:
  - desc: "Detect file() pattern in resolve() and read file content"
    files: ["engine/template.ts"]
  - desc: "Add load-time validateFileReferences() for {{file()}} paths"
    files: ["engine/config.ts"]
  - desc: "Add size warning on large file inclusion (threshold in config or constant)"
    files: ["engine/template.ts"]
  - desc: "Unit tests for file() resolution in template.ts"
    files: ["engine/template_test.ts"]
  - desc: "Validation tests for validateFileReferences() in config.ts"
    files: ["engine/config_test.ts"]
  - desc: "Integration: verify deno task check catches missing {{file()}} paths"
    files: ["scripts/check.ts"]
---

## Justification

I selected Variant A because it delivers the smallest change surface (S effort)
while keeping all `{{file()}}` logic centralized in `template.ts`. Key reasons:

1. **Single entry point preserved.** `resolve()` already handles all `{{...}}`
   patterns — adding `file("path")` detection here is a natural extension.
   Callers of `interpolate()` require zero changes (unlike Variant B's scattered
   call-site wrapping or Variant C's TemplateContext mutation across ~6 sites).

2. **I/O in resolve() is acceptable at runtime.** `interpolate()` runs
   exclusively at runtime (agent.ts line 144, engine.ts prepare_command) where
   I/O is expected. The "purity" concern is theoretical — no caller depends on
   `resolve()` being side-effect-free. Tests use temp files (consistent with
   existing `config_test.ts` patterns using `Deno.makeTempDir()`).

3. **Vision alignment.** AGENTS.md defines the engine as a "universal DAG-based
   engine" with "template interpolation" as a core capability. `{{file()}}` is
   a generic template function — not domain-specific. Centralizing it in the
   template module reinforces the engine's role as a composable, domain-agnostic
   toolkit.

4. **Risk mitigation.** Variant B's implicit two-function contract
   (`interpolate` then `resolveFiles`) is a maintenance hazard — a forgotten
   wrapping at any call site silently breaks file inclusion. Variant C mutates
   `TemplateContext` (a widely-used interface), forcing all context construction
   sites to change even when they don't use `file()`.

## Task Descriptions

### Task 1: Detect file() pattern in resolve()

In `template.ts` `resolve()`, add pattern detection for `file("...")` syntax
within the existing `{{...}}` regex match. When `key` matches
`/^file\("(.+)"\)$/`, extract path, resolve relative to `Deno.cwd()`, call
`Deno.readTextFileSync(resolved)`. Missing file → throw with diagnostic:
`{{file("${path}")}} — file not found: ${resolved}`. Return file contents
directly as replacement string (no re-interpolation — single-pass semantics).

### Task 2: Add load-time validateFileReferences()

In `config.ts`, add `validateFileReferences(config: PipelineConfig): void` that
scans all `task_template` and `prompt` fields (including loop body nodes) for
`/\{\{file\("([^"]+)"\)\}\}/g` pattern. For each match: check file existence
via `Deno.statSync()`. Skip paths containing `{{` (unresolvable template
variables at load time). Throw on missing file with node ID context. Call from
`mergeDefaults()` alongside existing `validatePromptPaths()`.

### Task 3: Size warning for large files

In `template.ts`, after `readTextFileSync()`, check `content.length` against a
threshold constant (e.g., `FILE_INCLUSION_SIZE_WARN_BYTES = 102400`). If
exceeded, emit `console.warn(...)` with path and size. Non-fatal — file still
included. Threshold as module-level constant (not configurable in v1).

### Task 4: Unit tests for file() resolution

In `template_test.ts`, add tests using `Deno.makeTempDir()` + temp files:
- `{{file("path")}}` resolves to file content
- `{{file("missing")}}` throws descriptive error
- File content containing `{{var}}` is NOT re-interpolated (literal passthrough)
- Mixed template: `{{input.pm}} and {{file("path")}}` both resolve correctly
- Size warning emitted for large file (capture console.warn)

### Task 5: Validation tests for validateFileReferences()

In `config_test.ts`, add tests:
- Config with valid `{{file("path")}}` in task_template passes validation
- Config with missing file path fails with diagnostic error
- Paths containing `{{input.x}}` inside file() are skipped (no validation error)
- Loop body node task_templates are also scanned

### Task 6: Integration with deno task check

Verify `scripts/check.ts` invokes config validation path that includes
`validateFileReferences()`. If `mergeDefaults()` already called by check
pipeline, no new code needed — just add integration test confirming
`deno task check` catches a bad `{{file()}}` reference.

## Summary

I selected Variant A (regex-based single-pass in `resolve()`) for its minimal
change surface, centralized logic, and alignment with the engine's template
interpolation architecture. I defined 6 dependency-ordered tasks covering core
implementation, load-time validation, size warnings, and TDD test coverage.
I created branch `sdlc/issue-128` and opened a draft PR.
