## Summary

### Files Changed

- `engine/template.ts` — Added `FILE_INCLUSION_SIZE_WARN_BYTES = 102400` constant (exported); added `file("path")` pattern detection in `resolve()` before dotted-path handling; reads file via `Deno.readTextFileSync()`, throws on missing file, emits `console.warn` when content exceeds threshold. Updated `interpolate()` JSDoc.
- `engine/config.ts` — Added exported `validateFileReferences(config: PipelineConfig): void` that scans all `task_template` and `prompt` fields (including loop body nodes) for `{{file("path")}}` patterns, skips paths containing `{{` (unresolvable at load time), and throws with node ID context on missing files. Called from `mergeDefaults()` alongside `validatePromptPaths()`.

### Tests Added

- `engine/template_test.ts` — 5 new tests: file() resolves to file content; missing file throws descriptive error; file content with `{{var}}` is NOT re-interpolated (literal passthrough); mixed template with other vars; size warning emitted for large file (console.warn captured).
- `engine/config_test.ts` — 4 new tests: valid file() reference passes; missing file() path throws; path containing `{{` is skipped; loop body node task_template with missing file throws.

### Check Status

PASS — 483 tests passed, 0 failed.
