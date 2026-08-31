<!-- section file — index: [documents/design-engine.md](../design-engine.md) -->

# SDS Engine — Non-Functional and Constraints

## 6. Non-Functional

- **Scale:** Single workflow per run. Sequential stages (no parallel agents).
- **Fault:** Node failure stops workflow (unless `on_error: continue`). Failure
  reported via `journal.jsonl` replay. `on_error: continue` emits info log per
  suppressed node (FR-E34). Configurable `on_failure_script` hook runs between
  the graph and the outcome wave, once per engine invocation, only when
  `workflowSuccess === false` (not when all failures suppressed) — and
  independently of whether the workflow declares any `run_on` node (FR-E99).
- **Logs:** Full transcripts per node in `.flowai-workflow/<workflow>/runs/<run-id>/logs/`.

## 7. Constraints

- **Simplified:** Pipeline runs sequentially (no parallel stages in v1).
- **Deferred:** Multi-repo support. Parallel workflows for multiple issues.
  Issue size/complexity limits. Budget alerts/notifications (FR-E47 covers
  enforcement only). Binary smoke tests in CI matrix. Package manager
  distribution. Windows binaries. Auto-update. SHA256 release checksums.
- **Deferred CLI flags per node:** Candidate flags need separate FRs after
  validation (`--max-budget-usd`, `--json-schema`, `--fallback-model`,
  `--name`, `--no-session-persistence`, `--settings`, `--mcp-config`,
  `--worktree`). Shipped: `--effort` (FR-E42),
  `--allowedTools`/`--disallowedTools` (FR-E48), `--permission-mode` (FR-E29).
