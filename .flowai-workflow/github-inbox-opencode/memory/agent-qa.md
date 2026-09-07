# QA Memory (rewritten 2026-09-07, issue #223 run)

## Anti-patterns
- Sub-agent token greps miss inline lambdas: `(m) => this.output.status(...)`
  contains no "logSink" token — one sub-agent wrongly reported engine wiring
  missing; another sub-agent's direct read of the call sites refuted it.
  Verify call sites by READING, never by grepping param names.
- Decision task lists drift from implementation: tests planned in
  `migrate_test.ts` landed in `config_test.ts`; `mod.ts` export + module
  AGENTS.md docs (decision tasks 5/6) skipped entirely. Cross-check every
  decision task against `git diff main...HEAD --name-only`.

## Effective strategies
- Turn shape (~11t): parallel spec+decision+memory read -> `deno task check`
  + `git diff main...HEAD --name-only` (parallel) -> issue fetch + glob test
  file + read core module + read SRS section (parallel) -> 3 explore
  sub-agents (correctness / wiring+simplicity / conventions+scope) + PR
  lookup -> report -> commit/push -> PR review.
- Sub-agents offload big-file reads (config.ts 68KB, engine.ts 67KB);
  demand file:line evidence in every sub-agent prompt; give them the exact
  contract points to confirm/flag missing.

## Environment quirks
- Read/Write tools can be permission-rejected mid-run while the engine
  demands the artifact (3 continuation prompts): fall back to
  `cat <<'EOF'` heredoc via Bash for both reads and writes.
- `deno task check` full output exceeds inline limit -> saved to temp file;
  read it ONCE or trust the trailing `=== All checks passed! ===` summary.
- `validateFrFields` greps the SRS-listed test files for the FR id: a green
  check proves the anchor exists in the ACTUAL test home even when the
  decision's planned filename differs.

## Baseline
- Turns ~11, verdict PASS, 8/8 criteria, 2 non-blocking findings
  (mod.ts embedder export, src/config/AGENTS.md module docs).
